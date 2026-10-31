// The hub: offscreen document holding the one WebSocket to the backend.
// Sends pair.hello first on every connect, mints meeting_id at Start,
// relays Port messages, owns the outbox. Transport-agnostic: Chrome and
// WebSocket wiring lives in the entrypoints.
import type { Envelope, MeetingContext } from "../../../contracts/ext/gen/types";
import type { ToHubPortMessage, ToPagePortMessage } from "../../../contracts/ext/port";
import { Outbox } from "./outbox";

export const HUB_START_MESSAGE = "halo/hub.start";
/** Popup -> hub: the Stop button. */
export const HUB_STOP_MESSAGE = "halo/hub.stop";
/** True while a meeting runs: the popup shows Stop only then. */
export const MEETING_RUNNING_KEY = "halo.meetingRunning";
export const TILE_NAMES_KEY = "halo/tileNames";

export interface SocketLike {
  connect(): void;
  isOpen(): boolean;
  send(data: string): void;
  sendBinary(data: Uint8Array): void;
  addEventListener(type: string, fn: (ev?: unknown) => void): void;
}

export interface HubDeps {
  socket: SocketLike;
  now: () => number;
  uuid: () => string;
  toPage: (msg: ToPagePortMessage) => void;
  storage: { set(key: string, value: unknown): void; get(key: string): unknown };
  token: string;
  extVersion: string;
  schedule?: (fn: () => void, ms: number) => void;
  /** Called once when the running meeting ends (stop the capture). */
  onEnded?: () => void;
}

/** Reconnect backoff: 1 s, 2 s, 4 s, capped at 5 s. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(5000, 1000 * 2 ** attempt);
}

export function isTestHook(url: string): boolean {
  return new URL(url).searchParams.get("halo_test") === "1";
}

/** kind=1 audio: [1][stream][seq u32 LE][ts_ms u64 LE] + PCM16 (contracts/binary). */
export function packAudioFrame(stream: 0 | 1, seq: number, tsMs: number, pcm: Uint8Array): Uint8Array {
  const out = new Uint8Array(14 + pcm.length);
  const view = new DataView(out.buffer);
  out[0] = 1;
  out[1] = stream;
  view.setUint32(2, seq, true);
  view.setBigUint64(6, BigInt(tsMs), true);
  out.set(pcm, 14);
  return out;
}

/** kind=3 rec: [3][seq u32 LE][ts_ms u64 LE] + webm bytes. */
export function packRecFrame(seq: number, tsMs: number, webm: Uint8Array): Uint8Array {
  const out = new Uint8Array(13 + webm.length);
  const view = new DataView(out.buffer);
  out[0] = 3;
  view.setUint32(1, seq, true);
  view.setBigUint64(5, BigInt(tsMs), true);
  out.set(webm, 13);
  return out;
}

export interface StartMeta {
  platform: "meet" | "zoom" | "teams";
  meeting_code: string;
  self_name: string;
}

export class Hub {
  readonly outbox: Outbox;
  meetingId: string | null = null;
  paired = false;
  fannedOut = 0;
  private latestContext: MeetingContext | null = null;
  private ended = false;
  private recorderOn = false;
  private seq: Record<"tab" | "mic", number> = { tab: 0, mic: 0 };
  private recSeq = 0;
  private socketOpen = false;
  private connected = false;
  private meetingCode = "";
  private reconnectAttempt = 0;
  private schedule: (fn: () => void, ms: number) => void;

  constructor(private deps: HubDeps) {
    this.schedule = deps.schedule ?? ((fn, ms) => { setTimeout(fn, ms); });
    this.outbox = new Outbox(
      (text) => deps.socket.send(text),
      () => this.socketOpen && this.paired, // nothing leaves before pair.ok
    );
    deps.socket.addEventListener("message", (ev) => {
      const data = (ev as { data?: unknown } | undefined)?.data;
      if (typeof data === "string") this.onSocketText(data);
    });
    deps.socket.addEventListener("open", () => {
      this.socketOpen = true;
      this.reconnectAttempt = 0;
      this.paired = false;
      this.sendPairHello(); // direct, not via the outbox: its reply is pair.ok, not an ACK
    });
    deps.socket.addEventListener("close", () => {
      this.socketOpen = false;
      this.paired = false;
      // No resend on close: schedule a reconnect with backoff instead.
      const delay = reconnectDelayMs(this.reconnectAttempt);
      this.reconnectAttempt += 1;
      this.schedule(() => this.deps.socket.connect(), delay);
    });
  }

  /** One socket per hub: a repeat Start must not open a second one (the close handler owns reconnects). */
  connect(): void {
    if (this.connected) return;
    this.connected = true;
    this.deps.socket.connect();
  }

  /** True while a meeting for this call runs (a repeat Start click). */
  isRunning(meetingCode: string): boolean {
    return this.meetingId !== null && !this.ended && this.meetingCode === meetingCode;
  }

  start(meta: StartMeta): string {
    this.meetingId = this.deps.uuid();
    this.meetingCode = meta.meeting_code;
    this.ended = false;
    this.deps.storage.set(MEETING_RUNNING_KEY, true);
    this.sendEnvelope("meeting.started", {
      meeting_id: this.meetingId, platform: meta.platform,
      meeting_code: meta.meeting_code, t0_ms: this.deps.now(),
      self_name: meta.self_name || this.heldSelfName(),
    }, this.meetingId);
    // The latest page state goes out for every new meeting: the Meet
    // Adapter only re-sends tiles when the DOM changes, and the Correlator
    // clears its tiles on meeting.started (live 2026-10-31: a second Start
    // got no tiles, so every turn was held and dropped).
    for (const msg of [...this.pageState]) this.onPortMessage(msg);
    return this.meetingId;
  }

  stop(reason: "left" | "tab_closed" | "timeout"): void {
    if (!this.meetingId || this.ended) return;
    this.ended = true;
    this.sendEnvelope("meeting.ended", { reason }, this.meetingId);
    this.deps.storage.set(MEETING_RUNNING_KEY, false);
    this.deps.onEnded?.();
  }

  /** A Meet-page reload must not end the meeting (60 s grace): no-op. */
  onPagePortDisconnected(): void {}

  /**
   * Best-effort self name: the latest tiles.snapshot's self tile.
   * The popup sends self_name "" (it cannot see the Meet DOM), so this
   * fills it when a snapshot arrived before Start; otherwise "" stands
   * and the Correlator still maps the mic stream to the self tile.
   */
  private heldSelfName(): string {
    for (const msg of this.pageState) {
      if (msg.type !== "tiles.snapshot") continue;
      const self = msg.data.tiles.find((t) => t.is_self);
      if (self && self.name) return self.name;
    }
    return "";
  }

  /** Latest tiles.snapshot and meeting.context, replayed at every Start. */
  private pageState: ToHubPortMessage[] = [];

  onPortMessage(msg: ToHubPortMessage): void {
    if (msg.type === "tiles.snapshot" || msg.type === "meeting.context") {
      this.pageState = this.pageState.filter((m) => m.type !== msg.type);
      this.pageState.push(msg);
    }
    if (!this.meetingId && msg.type !== "ack") {
      // No meeting yet: the Gateway drops meetingid=null envelopes, so
      // forwarding now would lose the page state; start() replays it.
      // Transient speaker events are dropped (a fresh one follows within
      // a poll cycle).
      return;
    }
    switch (msg.type) {
      case "meeting.context":
        this.latestContext = msg.data;
        this.sendEnvelope("meeting.context", msg.data, this.meetingId);
        break;
      case "tiles.snapshot":
        this.deps.storage.set(TILE_NAMES_KEY, msg.data.tiles.map((t) => t.name));
        this.sendEnvelope("tiles.snapshot", msg.data, this.meetingId);
        break;
      case "speaker.active":
        this.sendEnvelope("speaker.active", msg.data, this.meetingId);
        break;
      case "set_viewer_lang":
        if (this.latestContext) {
          const next = { ...this.latestContext, viewer_lang: msg.viewer_lang };
          this.latestContext = next;
          this.pageState = this.pageState.filter((m) => m.type !== "meeting.context");
          this.pageState.push({ type: "meeting.context", data: next });
          this.sendEnvelope("meeting.context", next, this.meetingId);
        }
        break;
      case "ack":
        this.outbox.ack(msg.ack.ack_of);
        break;
      case "call.left":
        this.stop("left");
        break;
      default:
        break; // participant.joined/left are hub-local bookkeeping only
    }
    this.pushStatus();
  }

  onSocketText(text: string): void {
    const msg = JSON.parse(text) as Record<string, unknown>;
    if (typeof msg.ack_of === "string") {
      this.outbox.ack(msg.ack_of);
      return;
    }
    const env = msg as unknown as Envelope;
    if (env.type === "pair.ok") {
      this.paired = true;
      this.outbox.resendAll(this.deps.now()); // held envelopes, same ids, once each
      return;
    }
    if (env.type === "pair.rejected") { this.paired = false; return; }
    if (!env.id || !this.outbox.firstSeen(env.id)) return; // dedupe by id
    this.fannedOut += 1;
    this.deps.toPage({ type: "backend.envelope", envelope: env });
  }

  pumpOutbox(): void {
    this.outbox.pump(this.deps.now());
    this.pushStatus();
  }

  sendAudio(stream: "tab" | "mic", pcm: Uint8Array, tsMs: number): void {
    if (!this.socketOpen || !this.paired) return; // audio held off the wire until pair.ok
    const byte = stream === "tab" ? 0 : 1;
    this.deps.socket.sendBinary(packAudioFrame(byte as 0 | 1, this.seq[stream]++, tsMs, pcm));
  }

  setRecorder(on: boolean): void {
    this.recorderOn = on;
  }

  sendRec(webm: Uint8Array, tsMs: number): void {
    if (!this.recorderOn) return; // Recorder switch only gates kind=3
    if (!this.socketOpen || !this.paired) return;
    this.deps.socket.sendBinary(packRecFrame(this.recSeq++, tsMs, webm));
  }

  private pushStatus(): void {
    this.deps.toPage({ type: "hub.status", outbox_backlog: this.outbox.backlog });
  }

  private makeEnvelope(type: Envelope["type"], data: unknown, meetingid: string | null): Envelope {
    return {
      specversion: "1.0",
      id: this.deps.uuid(),
      type,
      source: "halo/hub",
      time: new Date(this.deps.now()).toISOString(),
      meetingid,
      datacontenttype: "application/json",
      data: data as Record<string, unknown>,
    };
  }

  private sendPairHello(): void {
    if (!this.socketOpen) return; // never send on a non-open socket
    const env = this.makeEnvelope(
      "pair.hello", { token: this.deps.token, ext_version: this.deps.extVersion }, null);
    this.deps.socket.send(JSON.stringify(env));
  }

  private sendEnvelope(type: Envelope["type"], data: unknown, meetingid: string | null): void {
    this.outbox.enqueue(this.makeEnvelope(type, data, meetingid), this.deps.now());
  }
}

/**
 * Runtime-message handler for the Start gesture (#6): popup -> hub.
 * Returns true when a meeting started. A repeat Start for the running call
 * is a no-op (false); a Start for another call ends the running one first,
 * so every meeting.started gets its meeting.ended.
 */
export function handleHubRuntimeMessage(hub: Hub, msg: Record<string, unknown>): boolean {
  if (msg.type !== HUB_START_MESSAGE) return false;
  const meetingCode = String(msg.meeting_code ?? "");
  if (hub.isRunning(meetingCode)) return false;
  hub.stop("left");
  hub.start({
    platform: (msg.platform as StartMeta["platform"]) ?? "meet",
    meeting_code: meetingCode,
    self_name: String(msg.self_name ?? ""),
  });
  return true;
}
