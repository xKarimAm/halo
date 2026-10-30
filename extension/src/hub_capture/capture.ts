// Capture helpers: 100 ms PCM16 frames on the browser clock, streams kept
// apart (0=tab, 1=mic in hub.ts framing). Tab audio replays through a local
// sink (the AudioContext in the offscreen entrypoint) so the user still
// hears the call; only the kind=3 webm ever mixes tab + mic.

export interface AudioFrame {
  ts_ms: number;
  pcm: Int16Array;
}

export const FRAME_SAMPLES = 1600; // 100 ms at 16 kHz mono

export function chunkPcm16(samples: Int16Array, startTsMs: number): AudioFrame[] {
  const frames: AudioFrame[] = [];
  for (let i = 0; i < samples.length; i += FRAME_SAMPLES) {
    frames.push({ ts_ms: startTsMs + (i / FRAME_SAMPLES) * 100, pcm: samples.slice(i, i + FRAME_SAMPLES) });
  }
  return frames;
}

export interface ReplaySink {
  play(frame: AudioFrame): void;
}

/** Replay one tab frame locally (AudioContext in production, fake in tests). */
export function replayThrough(frame: AudioFrame, sink: ReplaySink): void {
  sink.play(frame);
}
