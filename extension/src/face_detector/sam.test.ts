import { describe, expect, it } from "vitest";
import { createSamDetect, SAM_WORKER_URL, SamFaceSource, serveSamPort } from "./sam";

const FACE = { box: [0.4, 0.2, 0.1, 0.3], head_anchor: [0.45, 0.2], conf: 0.9 };
const video = (w = 640, h = 360) => ({ videoWidth: w, videoHeight: h }) as HTMLVideoElement;

function source(detect: (b: string) => Promise<unknown>, over: Record<string, unknown> = {}) {
  let t = 1000;
  const updates: unknown[] = [];
  const src = new SamFaceSource({
    speakingTile: () => "tile-2",
    video: () => video(),
    encode: async () => "b64",
    detect: detect as never,
    onFaces: (u) => updates.push(u),
    now: () => t,
    ...over,
  });
  return { src, updates, advance: (ms: number) => { t += ms; } };
}

describe("SAM Halo mode source", () => {
  it("sends the speaking tile and hands a sam faces.update to the Overlay", async () => {
    const { src, updates } = source(async () => FACE);
    await src.tick();
    expect(updates).toEqual([{ tile_id: "tile-2", frame_ts_ms: 1000, engine: "sam",
      space: { frame_w: 640, frame_h: 360 }, face: FACE }]);
  });

  it("keeps one frame in flight and skips when nobody speaks or the video is empty", async () => {
    let calls = 0;
    let release!: () => void;
    const { src } = source(() => { calls += 1; return new Promise((r) => { release = () => r(FACE); }); });
    const first = src.tick();
    await src.tick(); // busy: no second request
    release();
    await first;
    expect(calls).toBe(1);
    const quiet = source(async () => FACE, { speakingTile: () => null });
    await quiet.src.tick();
    const blank = source(async () => FACE, { video: () => video(0, 0) });
    await blank.src.tick();
    expect(quiet.updates.length + blank.updates.length).toBe(0);
  });

  it("an error (no worker or no hub) pauses tries for 10 s: Frame mode meanwhile", async () => {
    let calls = 0;
    const { src, advance } = source(async () => { calls += 1; return "error"; });
    await src.tick();
    advance(9_999);
    await src.tick();
    expect(calls).toBe(1);
    advance(1);
    await src.tick();
    expect(calls).toBe(2);
  });
});

function fakePort() {
  const msgs: unknown[] = [];
  const onMsg: ((m: unknown) => void)[] = [];
  const onDisc: (() => void)[] = [];
  return {
    msgs, deliver: (m: unknown) => onMsg.forEach((f) => f(m)), disconnect: () => onDisc.forEach((f) => f()),
    port: {
      postMessage: (m: unknown) => msgs.push(m),
      onMessage: { addListener: (f: (m: unknown) => void) => onMsg.push(f) },
      onDisconnect: { addListener: (f: () => void) => onDisc.push(f) },
    },
  };
}

describe("SAM Port: content script <-> hub <-> worker", () => {
  it("the hub posts the JPEG bytes to the worker and answers with the face", async () => {
    const p = fakePort();
    const seen: { url: string; body: Uint8Array }[] = [];
    serveSamPort(p.port, (async (url: string, init: { body: Uint8Array }) => {
      seen.push({ url, body: init.body });
      return { ok: true, json: async () => ({ face: FACE }) };
    }) as never);
    p.deliver({ id: 7, jpeg: btoa("abc") });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen[0].url).toBe(SAM_WORKER_URL);
    expect([...seen[0].body]).toEqual([97, 98, 99]);
    expect(p.msgs).toEqual([{ id: 7, face: FACE }]);
  });

  it("the hub answers an error when the worker is down", async () => {
    const p = fakePort();
    serveSamPort(p.port, (async () => { throw new Error("ECONNREFUSED"); }) as never);
    p.deliver({ id: 1, jpeg: btoa("x") });
    await new Promise((r) => setTimeout(r, 0));
    expect(p.msgs).toEqual([{ id: 1, error: "sam worker unavailable" }]);
  });

  it("the content script matches replies by id, and a dropped hub fails the request", async () => {
    const p = fakePort();
    const detect = createSamDetect(() => p.port);
    const a = detect("one");
    expect(p.msgs).toEqual([{ id: 1, jpeg: "one" }]);
    p.deliver({ id: 1, face: FACE });
    expect(await a).toEqual(FACE);
    const b = detect("two");
    p.disconnect();
    expect(await b).toBe("error");
    const noHub = createSamDetect(() => { throw new Error("no receiver"); });
    expect(await noHub("x")).toBe("error");
  });
});
