import { describe, expect, it } from "vitest";
import { CaptureAccumulator, downmixToMono, resampleTo16kMono } from "./audio";

function sine(length: number, rate: number, freq: number, phase = 0): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) out[i] = Math.sin((2 * Math.PI * freq * (i + phase)) / rate);
  return out;
}

describe("downmixToMono", () => {
  it("averages stereo channels sample-wise, within one stream only", () => {
    const left = new Float32Array([0.5, -0.5, 0.0]);
    const right = new Float32Array([0.1, 0.1, 0.4]);
    expect(downmixToMono([left, right])).toEqual(new Float32Array([0.3, -0.2, 0.2]));
  });

  it("passes mono through and empty stays empty", () => {
    const mono = new Float32Array([0.2, -0.3]);
    expect(downmixToMono([mono])).toEqual(mono);
    expect(downmixToMono([])).toHaveLength(0);
  });
});

describe("resampleTo16kMono", () => {
  it("maps 48 kHz stereo-rate audio to 16 kHz PCM16 frames", () => {
    const pcm = resampleTo16kMono(sine(4800, 48000, 440), 48000);
    expect(pcm).toBeInstanceOf(Int16Array);
    expect(pcm).toHaveLength(1600); // 100 ms
    // 440 Hz sine peaks near sample 16000/440/4 ~= 9: amplitude survives.
    const peak = Math.max(...Array.from(pcm.slice(0, 40)).map(Math.abs));
    expect(peak).toBeGreaterThan(20000);
  });

  it("maps 44.1 kHz to 16 kHz with the right phase", () => {
    const pcm = resampleTo16kMono(sine(4410, 44100, 440), 44100);
    expect(pcm).toHaveLength(1600);
    // Sample 100 lands at t=6.25 ms: sin(2*pi*440*0.00625) ~= -1 -> near min.
    expect(pcm[100]).toBeLessThan(-20000);
  });

  it("clips out-of-range input instead of wrapping", () => {
    const pcm = resampleTo16kMono(new Float32Array([2.0, -2.0]), 16000);
    expect(Array.from(pcm)).toEqual([32767, -32768]);
  });
});

describe("CaptureAccumulator", () => {
  it("emits whole 1600-sample frames from 128-sample process quanta, ts +100 monotonic", () => {
    const acc = new CaptureAccumulator(1_000, 48000);
    const frames = [];
    // 40 quanta of 128 stereo samples at 48 kHz ~= 106 ms of audio.
    for (let q = 0; q < 40; q += 1) {
      frames.push(...acc.push([sine(128, 48000, 440, q * 128), sine(128, 48000, 440, q * 128)]));
    }
    expect(frames.length).toBeGreaterThanOrEqual(1);
    for (const f of frames) expect(f.pcm).toHaveLength(1600);
    const stamps = frames.map((f) => f.ts_ms);
    expect(stamps[0]).toBe(1000);
    for (let i = 1; i < stamps.length; i += 1) expect(stamps[i] - stamps[i - 1]).toBe(100);
    const total = frames.reduce((n, f) => n + f.pcm.length, 0);
    expect(total).toBe(Math.floor((40 * 128) / 3 / 1600) * 1600);
  });

  it("carries a short tail into the next push instead of emitting short frames", () => {
    const acc = new CaptureAccumulator(0, 16000);
    const first = acc.push([new Float32Array(1000).fill(0.1)]);
    expect(first).toHaveLength(0); // not a full frame yet
    const second = acc.push([new Float32Array(1000).fill(0.1)]);
    expect(second).toHaveLength(1);
    expect(second[0].ts_ms).toBe(0);
    expect(second[0].pcm[0]).toBe(Math.round(0.1 * 32767));
  });
});
