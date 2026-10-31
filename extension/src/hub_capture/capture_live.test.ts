import { describe, expect, it, vi } from "vitest";
import {
  adaptAudioContext,
  startLiveCapture,
  type AudioContextLike,
  type LiveCaptureDeps,
  type MediaDevicesLike,
  type ProcessorNode,
} from "./capture_live";

function sineChunk(length: number, rate: number, freq: number, phase: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) out[i] = 0.5 * Math.sin((2 * Math.PI * freq * (i + phase)) / rate);
  return out;
}

interface FakeProc extends ProcessorNode {
  fire(channels: Float32Array[]): void;
  connectedTo: unknown[];
}

function fakeProc(): FakeProc {
  const connectedTo: unknown[] = [];
  const proc: FakeProc = {
    connectedTo,
    onaudioprocess: null,
    connect: (node: unknown) => { connectedTo.push(node); },
    fire: (channels: Float32Array[]) => {
      proc.onaudioprocess?.({
        inputBuffer: {
          numberOfChannels: channels.length,
          getChannelData: (i: number) => channels[i],
        },
      });
    },
  };
  return proc;
}

interface FakeCtx extends AudioContextLike {
  procs: FakeProc[];
  sources: { connect: (n: unknown) => void; connected: unknown[] }[];
}

function fakeContext(): FakeCtx {
  const ctx: FakeCtx = {
    sampleRate: 48000,
    destination: { tag: "destination" },
    procs: [],
    sources: [],
    createMediaStreamSource: (_stream: MediaStream) => {
      const connected: unknown[] = [];
      const src = { connect: (n: unknown) => { connected.push(n); }, connected };
      ctx.sources.push(src);
      return src;
    },
    createScriptProcessor: () => {
      const proc = fakeProc();
      ctx.procs.push(proc);
      return proc;
    },
    createGain: () => ({ gain: { value: 1 }, connect: (_n: unknown) => {} }),
  };
  return ctx;
}

function fakeStream(): MediaStream {
  return {
    getAudioTracks: () => [{ getSettings: () => ({ channelCount: 2 }) }],
  } as unknown as MediaStream;
}

function depsWith(devices: MediaDevicesLike, ctx: FakeCtx) {
  const sent: { stream: string; bytes: number; ts: number }[] = [];
  const micStates: string[] = [];
  const deps: LiveCaptureDeps = {
    mediaDevices: devices,
    createContext: () => ctx,
    sendAudio: (stream, pcm, tsMs) => { sent.push({ stream, bytes: pcm.byteLength, ts: tsMs }); },
    setMicState: (s) => { micStates.push(s); },
    now: () => 7_000,
  };
  return { deps, sent, micStates };
}

describe("startLiveCapture", () => {
  it("sends tab as stream 0 and mic as stream 1, replaying only the tab", async () => {
    const ctx = fakeContext();
    const devices: MediaDevicesLike = { getUserMedia: async () => fakeStream() };
    const { deps, sent, micStates } = depsWith(devices, ctx);
    const res = await startLiveCapture("stream-id", deps);
    expect(res).toEqual({ tab: true, mic: true });
    expect(micStates).toEqual(["granted"]);
    expect(ctx.procs).toHaveLength(2);
    for (let q = 0; q < 40; q += 1) {
      ctx.procs[0].fire([sineChunk(128, 48000, 440, q * 128), sineChunk(128, 48000, 440, q * 128)]);
      ctx.procs[1].fire([sineChunk(128, 48000, 880, q * 128)]);
    }
    const tab = sent.filter((s) => s.stream === "tab");
    const mic = sent.filter((s) => s.stream === "mic");
    expect(tab.length).toBeGreaterThan(0);
    expect(mic.length).toBeGreaterThan(0);
    for (const f of [...tab, ...mic]) expect(f.bytes).toBe(3200);
    const stamps = tab.map((f) => f.ts);
    expect(stamps[0]).toBe(7000);
    for (let i = 1; i < stamps.length; i += 1) expect(stamps[i] - stamps[i - 1]).toBe(100);
    // The user keeps hearing the call (tab -> destination) but never the mic.
    expect(ctx.sources[0].connected).toContain(ctx.destination);
    expect(ctx.sources[1].connected).not.toContain(ctx.destination);
  });

  function isTabRequest(constraints: unknown): boolean {
    const audio = (constraints as { audio?: { mandatory?: { chromeMediaSource?: string } } })?.audio;
    return audio?.mandatory?.chromeMediaSource === "tab";
  }

  it("mic denied: tab continues, mic state surfaces as denied, no crash", async () => {
    const ctx = fakeContext();
    const devices: MediaDevicesLike = {
      getUserMedia: async (constraints: unknown) => {
        if (isTabRequest(constraints)) return fakeStream();
        throw new DOMException("Permission denied", "NotAllowedError");
      },
    };
    const { deps, sent, micStates } = depsWith(devices, ctx);
    const res = await startLiveCapture("stream-id", deps);
    expect(res).toEqual({ tab: true, mic: false });
    expect(micStates).toEqual(["denied"]);
    ctx.procs[0].fire([sineChunk(4800, 48000, 440, 0), sineChunk(4800, 48000, 440, 0)]);
    expect(sent.filter((s) => s.stream === "tab")).toHaveLength(1);
    expect(sent.some((s) => s.stream === "mic")).toBe(false);
  });

  it("no stream id (rig): skips tab capture, still tries the mic", async () => {
    const ctx = fakeContext();
    const getUserMedia = vi.fn(async () => fakeStream());
    const { deps, sent } = depsWith({ getUserMedia }, ctx);
    const res = await startLiveCapture(undefined, deps);
    expect(res).toEqual({ tab: false, mic: true });
    expect(getUserMedia).toHaveBeenCalledTimes(1); // mic only
    expect(sent).toHaveLength(0); // nothing processed yet
  });

  it("tab capture failing (rig): meeting proceeds without audio", async () => {
    const ctx = fakeContext();
    const devices: MediaDevicesLike = {
      getUserMedia: async (constraints: unknown) => {
        if (isTabRequest(constraints)) {
          throw new DOMException("no capture device", "NotFoundError");
        }
        return fakeStream();
      },
    };
    const { deps } = depsWith(devices, ctx);
    await expect(startLiveCapture("stream-id", deps)).resolves.toEqual({ tab: false, mic: true });
  });
});

describe("adaptAudioContext", () => {
  it("connects real nodes, never the wrappers (live: 'Overload resolution failed')", () => {
    const realNodes = new Set<object>();
    const node = (extra: object = {}) => {
      const n: Record<string, unknown> = {
        ...extra,
        connect: (target: unknown) => {
          if (!realNodes.has(target as object)) throw new TypeError("Overload resolution failed.");
        },
      };
      realNodes.add(n);
      return n;
    };
    const destination = node();
    const ctx = {
      sampleRate: 48000,
      destination,
      createMediaStreamSource: () => node(),
      createScriptProcessor: () => node({ onaudioprocess: null }),
      createGain: () => node({ gain: { value: 1 } }),
    } as unknown as AudioContext;
    const like = adaptAudioContext(ctx);
    const source = like.createMediaStreamSource({} as MediaStream);
    const proc = like.createScriptProcessor(4096, 2, 2);
    const sink = like.createGain();
    expect(() => {
      source.connect(like.destination);
      source.connect(proc);
      proc.connect(sink);
      sink.connect(like.destination);
    }).not.toThrow();
  });
});
