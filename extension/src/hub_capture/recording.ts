// Meeting recording (binary kind=3): the only place tab + mic mix
// (DECISIONS: "The recording mixes in the user's mic"). Runs in the
// offscreen hub. The tab stream feeds a MediaStream destination directly;
// the mic is captured in the Meet tab and arrives here as 16 kHz PCM16
// frames over the mic Port, so each frame is scheduled into the same
// destination as a short buffer. A MediaRecorder encodes the mix to webm
// and hands over 1 s chunks, stamped with the browser time each began.

export const MIC_RATE = 16_000;
const CHUNK_MS = 1000;
const LEAD_S = 0.25; // first frame / after a gap: absorbs Port relay jitter
const MAX_AHEAD_S = 2; // a burst beyond this is dropped, so the mix never drifts late

export interface RecorderLike {
  ondataavailable: ((ev: { data: { arrayBuffer(): Promise<ArrayBuffer> } }) => void) | null;
  start(timesliceMs: number): void;
  stop(): void;
}

/** The slice of AudioContext the recording uses (a real one in the hub, a fake in tests). */
export interface RecContext {
  readonly currentTime: number;
  createMediaStreamDestination(): { stream: MediaStream };
  createMediaStreamSource(stream: MediaStream): { connect(node: unknown): void };
  createBuffer(channels: number, length: number, sampleRate: number): {
    getChannelData(channel: number): Float32Array;
  };
  createBufferSource(): {
    buffer: unknown;
    connect(node: unknown): void;
    start(when: number): void;
  };
  close(): Promise<void>;
}

export interface RecordingDeps {
  ctx: RecContext;
  /** The captured Meet tab audio; absent when tab capture failed (mic-only recording). */
  tab?: MediaStream;
  makeRecorder(stream: MediaStream): RecorderLike;
  onChunk(webm: Uint8Array, tsMs: number): void;
  now(): number;
  /** Abort = meeting over: stop recording and free the context. */
  signal: AbortSignal;
}

export function startRecording(deps: RecordingDeps): { pushMic(pcm: Uint8Array): void } {
  const { ctx } = deps;
  const dest = ctx.createMediaStreamDestination();
  if (deps.tab) ctx.createMediaStreamSource(deps.tab).connect(dest);

  const rec = deps.makeRecorder(dest.stream);
  let chunkStart = deps.now();
  let order = Promise.resolve(); // chunks reach the hub in the order they were made
  rec.ondataavailable = (ev) => {
    const ts = chunkStart;
    chunkStart = deps.now();
    order = order
      .then(() => ev.data.arrayBuffer())
      .then((buf) => { if (buf.byteLength) deps.onChunk(new Uint8Array(buf), ts); })
      .catch(() => {}); // one lost chunk must not stop the rest
  };
  rec.start(CHUNK_MS);

  deps.signal.addEventListener("abort", () => {
    try { rec.stop(); } catch { /* already stopped */ }
    ctx.close().catch(() => {});
  });

  let cursor = 0; // context time where the next mic frame starts
  return {
    pushMic(pcm: Uint8Array): void {
      if (deps.signal.aborted) return;
      const n = pcm.byteLength >> 1;
      if (n === 0) return;
      const now = ctx.currentTime;
      if (cursor < now) cursor = now + LEAD_S; // first frame, or the mic paused
      if (cursor > now + MAX_AHEAD_S) return;
      const buffer = ctx.createBuffer(1, n, MIC_RATE);
      const out = buffer.getChannelData(0);
      const view = new DataView(pcm.buffer, pcm.byteOffset, n * 2);
      for (let i = 0; i < n; i += 1) out[i] = view.getInt16(i * 2, true) / 32768;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(dest);
      src.start(cursor);
      cursor += n / MIC_RATE;
    },
  };
}
