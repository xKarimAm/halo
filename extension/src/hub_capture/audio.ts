// Live capture DSP: pure functions over samples. The offscreen entrypoint
// feeds ScriptProcessor quanta in here and sends the resulting 100 ms
// frames as kind=1 binary (stream 0 = tab, 1 = mic, via hub.sendAudio).
// Streams are never mixed here: each stream downmixes its own stereo to
// mono (decisions: tab and mic stay apart; only the kind=3 webm mixes).
import { FRAME_SAMPLES, type AudioFrame } from "./capture";

export const CAPTURE_SAMPLE_RATE = 16000;

/** Sample-wise channel average (stereo downmixed within its own stream). */
export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  const length = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    let sum = 0;
    for (const c of channels) sum += c[i];
    out[i] = sum / channels.length;
  }
  return out;
}

/** Linear-interpolate mono float samples from fromRate to 16 kHz PCM16. */
export function resampleTo16kMono(mono: Float32Array, fromRate: number): Int16Array {
  if (fromRate === CAPTURE_SAMPLE_RATE) {
    return Int16Array.from(mono, (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32767))));
  }
  const ratio = fromRate / CAPTURE_SAMPLE_RATE;
  const length = Math.floor(mono.length / ratio);
  const out = new Int16Array(length);
  for (let i = 0; i < length; i += 1) {
    const pos = i * ratio;
    const base = Math.floor(pos);
    const frac = pos - base;
    const a = mono[base] ?? 0;
    const b = mono[base + 1] ?? a;
    out[i] = Math.max(-32768, Math.min(32767, Math.round((a + (b - a) * frac) * 32767)));
  }
  return out;
}

function concat(a: Int16Array, b: Int16Array): Int16Array {
  const out = new Int16Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Accumulates 16 kHz mono samples across process() calls and emits whole
 * 100 ms frames (1600 samples). A short tail is carried into the next push,
 * never emitted short. Timestamps step +100 ms from the stream start, so
 * they are monotonic by construction on the browser clock.
 */
export class CaptureAccumulator {
  private tail = new Int16Array(0);
  private emitted = 0;

  constructor(
    private readonly startTsMs: number,
    private readonly fromRate: number,
  ) {}

  push(channels: Float32Array[]): AudioFrame[] {
    const pcm16 = resampleTo16kMono(downmixToMono(channels), this.fromRate);
    const joined = concat(this.tail, pcm16);
    const frames: AudioFrame[] = [];
    let offset = 0;
    while (joined.length - offset >= FRAME_SAMPLES) {
      frames.push({
        ts_ms: this.startTsMs + this.emitted * 100,
        pcm: joined.slice(offset, offset + FRAME_SAMPLES),
      });
      this.emitted += 1;
      offset += FRAME_SAMPLES;
    }
    this.tail = joined.slice(offset);
    return frames;
  }
}
