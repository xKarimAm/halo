import { describe, expect, it } from "vitest";
import {
  HUB_START_MESSAGE,
  Hub,
  MEETING_RUNNING_KEY,
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
  open = false;
  connectCalls = 0;
  sentWhileClosed = 0;
  private handlers: Record<string, ((ev?: unknown) => void)[]> = {};
  connect(): void { this.connectCalls += 1; }
  isOpen(): boolean { return this.open; }
  send(data: string): void {
    if (!this.open) { this.sentWhileClosed += 1; return; }
    this.sent.push(data);
  }
  sendBinary(data: Uint8Array): void {
    if (!this.open) { this.sentWhileClosed += 1; return; }
    this.binary.push(data);
  }
  addEventListener(type: string, fn: (ev?: unknown) => void): void {
    (this.handlers[type] ??= []).push(fn);
  }
  emit(type: string, ev?: unknown): void {
    if (type === "open") this.open = true;
    if (type === "close") this.open = false;
    for (const fn of this.handlers[type] ?? []) fn(ev);
  }
  receive(text: string): void { this.emit("message", { data: text }); }
  envelopes(): Record<string, unknown>[] { return this.sent.map((s) => JSON.parse(s)); }
}

function pairOk(socket: FakeSocket): void {
  socket.receive(JSON.stringify({
    specversion: "1.0", id: "srv-pair", type: "pair.ok", source: "halo/gateway",
    time: "t", meetingid: null, datacontenttype: "application/json", data: { session_id: "s-1" },
  }));
}

function openAndPair(hub: Hub, socket: FakeSocket): void {
  hub.connect();
  socket.emit("open");
  pairOk(socket);
}

function makeHub() {
  const socket = new FakeSocket();
  let now = 1_000;
  let seq = 0;
  const page: unknown[] = [];
  const storage = new Map<string, unknown>();
  const scheduled: { fn: () => void; ms: number }[] = [];
  const deps: HubDeps = {
    socket,
    now: () => now,
    uuid: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
    toPage: (msg) => page.push(msg),
    storage: { set: (k, v) => storage.set(k, v), get: (k) => storage.get(k) },
    token: "123456",
    extVersion: "0.1.0",
    schedule: (fn, ms) => scheduled.push({ fn, ms }),
  };
  return {
    hub: new Hub(deps), socket, page, storage, scheduled,
    tick: (ms: number) => { now += ms; },
    runNextScheduled: () => scheduled.shift()?.fn(),
  };
}

const started = { platform: "meet" as const, meeting_code: "abc-defg-hij", self_name: "Karim Amer" };

// (1) ?halo_test=1 opens it; pair.hello first, then meeting.started fresh UUID
describe("hub lifecycle", () => {
  it("sends pair.hello first, then meeting.started with a fresh UUID", () => {
    const { hub, socket } = makeHub();
    expect(isTestHook("https://meet.google.com/x?halo_test=1")).toBe(true);
    expect(isTestHook("https://meet.google.com/x")).toBe(false);
    hub.connect();
    socket.emit("open");
    hub.start(started);
    pairOk(socket);
    const envs = socket.envelopes();
    expect(envs[0].type).toBe("pair.hello");
    expect((envs[0].data as Record<string, unknown>).token).toBe("123456");
    expect(envs[1].type).toBe("meeting.started");
    const data = envs[1].data as Record<string, unknown>;
    expect(data.meeting_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(envs[1].meetingid).toBe(data.meeting_id);
  });

  // Page state sent before Start must not go out with meetingid=null
  // (the Gateway drops those): it is replayed at Start, after started.
  it("holds pre-Start tiles/context and replays them at Start", () => {
    const { hub, socket, storage } = makeHub();
    openAndPair(hub, socket);
    const tiles = [{ tile_id: "t1", name: "Layla", is_self: false, rect: [0, 0, 1, 1], video_w: 640, video_h: 360, fit: "cover" as const, captions_rect: null }];
    hub.onPortMessage({ type: "tiles.snapshot", data: { tiles } });
    hub.onPortMessage({ type: "speaker.active", data: { tile_id: "t1", speaking: true, ts_ms: 1 } });
    expect(socket.envelopes().some((e) => e.type === "tiles.snapshot")).toBe(false);
    hub.start(started);
    const envs = socket.envelopes();
    const types = envs.map((e) => e.type);
    expect(types.indexOf("tiles.snapshot")).toBeGreaterThan(types.indexOf("meeting.started"));
    const snap = envs.find((e) => e.type === "tiles.snapshot");
    expect(snap?.meetingid).toBe(hub.meetingId);
    expect(envs.some((e) => e.type === "speaker.active")).toBe(false); // transient: dropped
    expect(storage.get("halo/tileNames")).toEqual(["Layla"]);
  });

  // (6) one meeting.ended on Stop; Meet-page reload does not end it
  it("ends once on stop and survives a page reload", () => {
    const { hub, socket } = makeHub();
    openAndPair(hub, socket);
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
    openAndPair(hub, socket);
    hub.start(started);
    const ctx = { subject: "S", agenda: [], roles: [], viewer_lang: "en" as const };
    hub.onPortMessage({ type: "meeting.context", data: ctx });
    const firstSend = socket.sent.length;
    tick(2001);
    hub.pumpOutbox();
    expect(socket.sent.length).toBe(firstSend + 2); // started + context due; pair.hello is not in the outbox
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
    openAndPair(hub, socket);
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
    openAndPair(hub, socket);
    hub.start(started);
    hub.sendAudio("tab", new Uint8Array(3200), 1000);
    hub.sendAudio("mic", new Uint8Array(3200), 1000);
    expect(socket.binary[0][1]).toBe(0);
    expect(socket.binary[1][1]).toBe(1);
  });

  it("recorder switch stops kind=3 while audio continues", () => {
    const { hub, socket } = makeHub();
    openAndPair(hub, socket);
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

// Review fix: socket reconnect with backoff + pairing gate
describe("socket reconnect", () => {
  it("drop mid-meeting -> reconnect -> pair.hello first -> after pair.ok every pending id resent once", () => {
    const { hub, socket, scheduled, runNextScheduled } = makeHub();
    openAndPair(hub, socket);
    hub.start(started);
    hub.onPortMessage({ type: "meeting.context", data: { subject: "S", agenda: [], roles: [], viewer_lang: "en" } });
    const pendingIds = socket.envelopes().filter((e) => e.type !== "pair.hello").map((e) => e.id as string);
    expect(pendingIds.length).toBeGreaterThan(0);

    socket.emit("close"); // drop mid-meeting: no resend on close
    const sentAtClose = socket.sent.length;
    hub.sendAudio("tab", new Uint8Array(3200), 2000); // held off the wire while down
    expect(socket.sent.length).toBe(sentAtClose);
    expect(socket.binary).toHaveLength(0);
    expect(scheduled.map((s) => s.ms)).toEqual([1000]); // first backoff

    runNextScheduled(); // reconnect attempt fires
    expect(socket.connectCalls).toBe(2);
    socket.emit("close"); // attempt fails too: backoff grows, still nothing sent
    expect(scheduled.map((s) => s.ms)).toEqual([2000]);
    runNextScheduled();
    socket.emit("open");
    const afterOpen = socket.envelopes();
    expect(afterOpen[afterOpen.length - 1].type).toBe("pair.hello"); // hello first, direct
    const helloCount = socket.sent.length;

    hub.onPortMessage({ type: "speaker.active", data: { tile_id: "t1", speaking: true, ts_ms: 1 } }); // held until pair.ok
    expect(socket.sent.length).toBe(helloCount);
    pairOk(socket);
    const resent = socket.envelopes().slice(helloCount).map((e) => e.id as string);
    for (const id of pendingIds) {
      expect(resent.filter((x) => x === id)).toHaveLength(1); // each pending id exactly once
    }
    expect(resent.length).toBe(pendingIds.length + 1); // + the speaker.active held meanwhile
    expect(socket.sentWhileClosed).toBe(0); // never sent on a non-open socket
  });

  it("backoff caps at 5 s: 1, 2, 4, 5, 5", () => {
    const { hub, socket, scheduled, runNextScheduled } = makeHub();
    openAndPair(hub, socket);
    const delays: number[] = [];
    for (let i = 0; i < 5; i++) {
      socket.emit("close");
      delays.push(scheduled[scheduled.length - 1].ms);
      runNextScheduled();
    }
    expect(delays).toEqual([1000, 2000, 4000, 5000, 5000]);
  });
});

// Self name: best-effort from the held pre-Start snapshot, else ""
describe("self name derivation", () => {
  const tiles = (name: string) => ({
    type: "tiles.snapshot" as const,
    data: {
      tiles: [
        { tile_id: "t1", name, is_self: true, rect: [0, 0, 1, 1], video_w: 640, video_h: 360, fit: "cover" as const, captions_rect: null },
        { tile_id: "t2", name: "Layla", is_self: false, rect: [0, 0, 1, 1], video_w: 640, video_h: 360, fit: "cover" as const, captions_rect: null },
      ],
    },
  });

  it("fills an empty self_name from the held snapshot's self tile", () => {
    const { hub, socket } = makeHub();
    openAndPair(hub, socket);
    hub.onPortMessage(tiles("Karim Amer"));
    hub.start({ ...started, self_name: "" });
    const data = socket.envelopes().find((e) => e.type === "meeting.started")?.data as Record<string, unknown>;
    expect(data.self_name).toBe("Karim Amer");
  });

  it("an explicit self_name wins; no snapshot means empty", () => {
    const { hub, socket } = makeHub();
    openAndPair(hub, socket);
    hub.onPortMessage(tiles("Karim Amer"));
    hub.start(started); // self_name "Karim Amer" already set
    const data = socket.envelopes().find((e) => e.type === "meeting.started")?.data as Record<string, unknown>;
    expect(data.self_name).toBe("Karim Amer");

    const fresh = makeHub();
    openAndPair(fresh.hub, fresh.socket);
    fresh.hub.start({ ...started, self_name: "" });
    const data2 = fresh.socket.envelopes().find((e) => e.type === "meeting.started")?.data as Record<string, unknown>;
    expect(data2.self_name).toBe("");
  });
});

// Issue #6: start handoff + tile-names storage convention
describe("setup_panel handoff (#6)", () => {
  it("runtime start message mints and sends meeting.started; tiles persist names", () => {
    const { hub, socket, storage } = makeHub();
    hub.connect();
    socket.emit("open");
    const res = handleHubRuntimeMessage(hub, { type: HUB_START_MESSAGE, ...started });
    pairOk(socket);
    expect(res).toBe(true);
    expect(socket.envelopes().some((e) => e.type === "meeting.started")).toBe(true);
    hub.onPortMessage({
      type: "tiles.snapshot",
      data: { tiles: [{ tile_id: "t1", name: "Layla", is_self: false, rect: [0, 0, 1, 1], video_w: 640, video_h: 360, fit: "cover", captions_rect: null }] },
    });
    expect(storage.get("halo/tileNames")).toEqual(["Layla"]);
  });
});


// Platform audit (real Chrome): Start pressed again while a meeting runs.
describe("repeat Start", () => {
  it("opens one socket, keeps the running call, ends it before another call starts", () => {
    const { hub, socket } = makeHub();
    hub.connect();
    hub.connect(); // second Start: no second WebSocket
    expect(socket.connectCalls).toBe(1);
    socket.emit("open");
    pairOk(socket);
    expect(handleHubRuntimeMessage(hub, { type: HUB_START_MESSAGE, ...started })).toBe(true);
    const first = hub.meetingId;
    expect(handleHubRuntimeMessage(hub, { type: HUB_START_MESSAGE, ...started })).toBe(false);
    expect(hub.meetingId).toBe(first); // same call: same meeting, no second capture
    expect(handleHubRuntimeMessage(hub, { type: HUB_START_MESSAGE, ...started, meeting_code: "xyz-abcd-efg" })).toBe(true);
    const lifecycle = socket.envelopes()
      .filter((e) => e.type === "meeting.started" || e.type === "meeting.ended")
      .map((e) => `${e.type}:${e.meetingid}`);
    expect(lifecycle).toEqual([
      `meeting.started:${first}`, `meeting.ended:${first}`, `meeting.started:${hub.meetingId}`,
    ]);
  });
});

// Issue #72: the user leaves the call (or presses Stop) with the tab open.
describe("left the call", () => {
  it("call.left on the Port ends the running meeting once, with reason left", () => {
    const { hub, socket, storage } = makeHub();
    let ended = 0;
    (hub as unknown as { deps: HubDeps }).deps.onEnded = () => { ended += 1; };
    openAndPair(hub, socket);
    hub.onPortMessage({ type: "call.left" }); // no meeting yet: ignored
    expect(ended).toBe(0);
    hub.start(started);
    expect(storage.get(MEETING_RUNNING_KEY)).toBe(true);
    hub.onPortMessage({ type: "call.left" });
    hub.onPortMessage({ type: "call.left" }); // second signal: no second meeting.ended
    const ends = socket.envelopes().filter((e) => e.type === "meeting.ended");
    expect(ends).toHaveLength(1);
    expect(ends[0].meetingid).toBe(hub.meetingId);
    expect(ends[0].data).toEqual({ reason: "left" });
    expect(storage.get(MEETING_RUNNING_KEY)).toBe(false);
    expect(ended).toBe(1); // the entrypoint stops the capture here
  });

  it("a page reload (Port disconnect) does not end the meeting", () => {
    const { hub, socket } = makeHub();
    openAndPair(hub, socket);
    hub.start(started);
    hub.onPagePortDisconnected();
    expect(socket.envelopes().some((e) => e.type === "meeting.ended")).toBe(false);
  });
});
