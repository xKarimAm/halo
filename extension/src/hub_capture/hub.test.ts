import { describe, expect, it } from "vitest";
import {
  HUB_START_MESSAGE,
  Hub,
  handleHubRuntimeMessage,
  isTestHook,
  packAudioFrame,
  packRecFrame,
  type HubDeps,
  type SocketLike,
} from "./hub";
import { chunkPcm16, replayThrough } from "./capture";

class FakeSocket implements SocketLike {
  sent: string[] = [];
  binary: Uint8Array[] = [];
  private handlers: Record<string, ((ev?: unknown) => void)[]> = {};
  send(data: string): void { this.sent.push(data); }
  sendBinary(data: Uint8Array): void { this.binary.push(data); }
  addEventListener(type: string, fn: (ev?: unknown) => void): void {
    (this.handlers[type] ??= []).push(fn);
  }
  emit(type: string, ev?: unknown): void { for (const fn of this.handlers[type] ?? []) fn(ev); }
  receive(text: string): void { this.emit("message", { data: text }); }
  envelopes(): Record<string, unknown>[] { return this.sent.map((s) => JSON.parse(s)); }
}

function makeHub() {
  const socket = new FakeSocket();
  let now = 1_000;
  let seq = 0;
  const page: unknown[] = [];
  const storage = new Map<string, unknown>();
  const deps: HubDeps = {
    socket,
    now: () => now,
    uuid: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
    toPage: (msg) => page.push(msg),
    storage: { set: (k, v) => storage.set(k, v), get: (k) => storage.get(k) },
    token: "123456",
    extVersion: "0.1.0",
  };
  return { hub: new Hub(deps), socket, page, storage, tick: (ms: number) => { now += ms; } };
}

const started = { platform: "meet" as const, meeting_code: "abc-defg-hij", self_name: "Karim Amer" };

// (1) ?halo_test=1 opens it; pair.hello first, then meeting.started fresh UUID
describe("hub lifecycle", () => {
  it("sends pair.hello first, then meeting.started with a fresh UUID", () => {
    const { hub, socket } = makeHub();
    expect(isTestHook("https://meet.google.com/x?halo_test=1")).toBe(true);
    expect(isTestHook("https://meet.google.com/x")).toBe(false);
    hub.connect();
    hub.start(started);
    const envs = socket.envelopes();
    expect(envs[0].type).toBe("pair.hello");
    expect((envs[0].data as Record<string, unknown>).token).toBe("123456");
    expect(envs[1].type).toBe("meeting.started");
    const data = envs[1].data as Record<string, unknown>;
    expect(data.meeting_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(envs[1].meetingid).toBe(data.meeting_id);
  });

  // (6) one meeting.ended on Stop; Meet-page reload does not end it
  it("ends once on stop and survives a page reload", () => {
    const { hub, socket } = makeHub();
    hub.connect();
    hub.start(started);
    hub.onPagePortDisconnected(); // Meet-page reload: hub survives the grace
    hub.stop("left");
    hub.stop("left");
    const ended = socket.envelopes().filter((e) => e.type === "meeting.ended");
    expect(ended).toHaveLength(1);
    expect((ended[0].data as Record<string, unknown>).reason).toBe("left");
  });
});

// (2) no ACK in 2 s -> same id resent; reconnect resends; receiver dedupes
describe("outbox", () => {
  it("resends the same id after 2 s and dedupes inbound", () => {
    const { hub, socket, tick } = makeHub();
    hub.connect();
    hub.start(started);
    const ctx = { subject: "S", agenda: [], roles: [], viewer_lang: "en" as const };
    hub.onPortMessage({ type: "meeting.context", data: ctx });
    const firstSend = socket.sent.length;
    tick(2001);
    hub.pumpOutbox();
    expect(socket.sent.length).toBe(firstSend + 3); // pair.hello + started + context all due
    const resent = JSON.parse(socket.sent[socket.sent.length - 1]);
    expect(resent.id).toBe(JSON.parse(socket.sent[firstSend - 1]).id);
    const point = JSON.stringify({
      specversion: "1.0", id: "p-1", type: "points.upsert", source: "halo/gateway",
      time: "t", meetingid: "m", datacontenttype: "application/json", data: {},
    });
    hub.onSocketText(point);
    hub.onSocketText(point); // duplicate delivery
    expect(hub.fannedOut).toBe(1);
  });
});

// (4) set_viewer_lang -> exactly one resent context, only the language differs
describe("viewer language", () => {
  it("resends the latest context once with the new language", () => {
    const { hub, socket } = makeHub();
    hub.connect();
    hub.start(started);
    const ctx = { subject: "S", agenda: ["a"], roles: [], viewer_lang: "en" as const };
    hub.onPortMessage({ type: "meeting.context", data: ctx });
    const before = socket.sent.length;
    hub.onPortMessage({ type: "set_viewer_lang", viewer_lang: "ar" });
    const news = socket.envelopes().slice(before);
    expect(news).toHaveLength(1);
    expect(news[0].type).toBe("meeting.context");
    expect(news[0].data).toEqual({ ...ctx, viewer_lang: "ar" });
  });
});

// (3) audio framing + (5) recorder switch
describe("binary frames", () => {
  it("packs little-endian kind=1 frames, streams kept apart, monotonic ts", () => {
    const f = packAudioFrame(1, 7, 5000, new Uint8Array([1, 2]));
    expect(f[0]).toBe(1);
    expect(f[1]).toBe(1); // mic stream byte
    expect(new DataView(f.buffer).getUint32(2, true)).toBe(7);
    expect(Number(new DataView(f.buffer).getBigUint64(6, true))).toBe(5000);
    const { hub, socket } = makeHub();
    hub.connect();
    hub.start(started);
    hub.sendAudio("tab", new Uint8Array(3200), 1000);
    hub.sendAudio("mic", new Uint8Array(3200), 1000);
    expect(socket.binary[0][1]).toBe(0);
    expect(socket.binary[1][1]).toBe(1);
  });

  it("recorder switch stops kind=3 while audio continues", () => {
    const { hub, socket } = makeHub();
    hub.connect();
    hub.start(started);
    hub.setRecorder(true);
    hub.sendRec(new Uint8Array([9]), 1000);
    hub.setRecorder(false);
    hub.sendRec(new Uint8Array([9]), 1100);
    hub.sendAudio("tab", new Uint8Array(3200), 1100);
    const kinds = socket.binary.map((b) => b[0]);
    expect(kinds).toEqual([3, 1]);
    expect(packRecFrame(1, 5, new Uint8Array(0))[0]).toBe(3);
  });
});

// Capture helpers: 100 ms chunking + local replay so the user hears the call
describe("capture helpers", () => {
  it("chunks PCM16 into 100 ms frames and replays tab audio locally", () => {
    const frames = chunkPcm16(new Int16Array(1600 * 3), 1000);
    expect(frames).toHaveLength(3);
    expect(frames[1].ts_ms).toBe(1100);
    const played: unknown[] = [];
    replayThrough(frames[0], { play: (f: unknown) => played.push(f) });
    expect(played).toHaveLength(1);
  });
});

// Issue #6: start handoff + tile-names storage convention
describe("setup_panel handoff (#6)", () => {
  it("runtime start message mints and sends meeting.started; tiles persist names", () => {
    const { hub, socket, storage } = makeHub();
    hub.connect();
    const res = handleHubRuntimeMessage(hub, { type: HUB_START_MESSAGE, ...started });
    expect(res).toBe(true);
    expect(socket.envelopes().some((e) => e.type === "meeting.started")).toBe(true);
    hub.onPortMessage({
      type: "tiles.snapshot",
      data: { tiles: [{ tile_id: "t1", name: "Layla", is_self: false, rect: [0, 0, 1, 1], video_w: 640, video_h: 360, fit: "cover", captions_rect: null }] },
    });
    expect(storage.get("halo/tileNames")).toEqual(["Layla"]);
  });
});
