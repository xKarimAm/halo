import { describe, expect, it } from "vitest";
import { MIC_RATE, startRecording, type RecContext, type RecorderLike } from "./recording";

// Fake Web Audio: records what was scheduled where.
function fakeCtx() {
  const started: { at: number; seconds: number; first: number }[] = [];
  const connected: unknown[] = [];
  const dest = { stream: { id: "mix" } as unknown as MediaStream };
  let closed = false;
  const ctx: RecContext & { currentTime: number } = {
    currentTime: 10,
    createMediaStreamDestination: () => dest as never,
    createMediaStreamSource: () => ({ connect: (d: unknown) => { connected.push(d); } }) as never,
    createBuffer: (_ch: number, length: number, rate: number) => {
      const data = new Float32Array(length);
      return { duration: length / rate, getChannelData: () => data } as never;
    },
    createBufferSource: () => {
      const src = {
        buffer: null as null | { duration: number; getChannelData(c: number): Float32Array },
        connect: (d: unknown) => { connected.push(d); },
        start: (at: number) => {
          started.push({ at, seconds: src.buffer!.duration, first: src.buffer!.getChannelData(0)[0] });
        },
      };
      return src as never;
    },
    close: async () => { closed = true; },
  };
  return { ctx, dest, started, connected, isClosed: () => closed };
}

function fakeRecorder() {
  const rec: RecorderLike & { started?: number; stopped: boolean; emit(bytes: number[]): void } = {
    ondataavailable: null,
    stopped: false,
    start(slice: number) { rec.started = slice; },
    stop() { rec.stopped = true; },
    emit(bytes: number[]) {
      rec.ondataavailable?.({ data: { arrayBuffer: async () => new Uint8Array(bytes).buffer } });
    },
  };
  return rec;
}

const frame = (samples: number[]) => new Uint8Array(new Int16Array(samples).buffer);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("recording (tab + mic mixed into one webm)", () => {
  it("mixes the tab in, schedules mic frames back to back, and sends 1 s chunks stamped with their start", async () => {
    const { ctx, dest, started, connected } = fakeCtx();
    const rec = fakeRecorder();
    const chunks: [number[], number][] = [];
    let now = 5000;
    const abort = new AbortController();
    const recording = startRecording({
      ctx, tab: {} as MediaStream, makeRecorder: () => rec, now: () => now,
      onChunk: (bytes, ts) => chunks.push([[...bytes], ts]), signal: abort.signal,
    });
    expect(connected).toContain(dest); // tab source feeds the mix
    expect(rec.started).toBe(1000);

    const tenth = MIC_RATE / 10; // one 100 ms frame
    recording.pushMic(frame([16384, ...Array(tenth - 1).fill(0)]));
    recording.pushMic(frame(Array(tenth).fill(0)));
    expect(started).toHaveLength(2);
    expect(started[0].first).toBeCloseTo(0.5); // PCM16 -> float
    expect(started[1].at).toBeCloseTo(started[0].at + 0.1); // no gap, no overlap
    expect(started[0].at).toBeGreaterThan(ctx.currentTime); // small lead absorbs relay jitter

    now = 6000; // the first chunk ends 1 s in
    rec.emit([1, 2]);
    now = 7000;
    rec.emit([3]);
    await flush();
    expect(chunks).toEqual([[[1, 2], 5000], [[3], 6000]]);
  });

  it("re-anchors after a mic gap and drops frames that run far ahead of the clock", () => {
    const { ctx, started } = fakeCtx();
    const recording = startRecording({
      ctx, makeRecorder: () => fakeRecorder(), now: () => 0, onChunk: () => {},
      signal: new AbortController().signal,
    });
    const tenth = frame(Array(MIC_RATE / 10).fill(0));
    recording.pushMic(tenth);
    ctx.currentTime += 5; // mic paused 5 s
    recording.pushMic(tenth);
    expect(started[1].at).toBeGreaterThan(ctx.currentTime);
    for (let i = 0; i < 40; i += 1) recording.pushMic(tenth); // 4 s burst at once
    const last = started[started.length - 1].at;
    expect(last - ctx.currentTime).toBeLessThanOrEqual(2.1); // never more than ~2 s queued
  });

  it("abort stops the recorder and closes the audio context", () => {
    const { ctx, isClosed } = fakeCtx();
    const rec = fakeRecorder();
    const abort = new AbortController();
    startRecording({ ctx, makeRecorder: () => rec, now: () => 0, onChunk: () => {}, signal: abort.signal });
    abort.abort();
    expect(rec.stopped).toBe(true);
    expect(isClosed()).toBe(true);
  });
});
