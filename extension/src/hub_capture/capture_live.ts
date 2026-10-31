// Live capture orchestration: the tab stream (stream 0) and the mic stream
// (stream 1) into hub.sendAudio as 100 ms 16 kHz mono PCM16 frames. In the
// extension the two run in different places: the offscreen hub taps the tab
// (`mic: false`), the Meet content script taps the mic (no stream id), since
// a content script uses meet.google.com's mic grant and needs no prompt. The tab
// replays through the AudioContext destination so the user still hears the
// call; the mic never touches the destination (headset, no echo).
// Degradation is per-stream and silent-safe: no stream id (the Playwright
// rig) or a failed getUserMedia skips that stream and the meeting proceeds
// without its audio instead of crashing.
import { CaptureAccumulator } from "./audio";

export type CaptureStream = "tab" | "mic";

export interface AudioProcessEvent {
  inputBuffer: {
    numberOfChannels: number;
    getChannelData(channel: number): Float32Array;
  };
}

export interface ProcessorNode {
  connect(node: unknown): void;
  onaudioprocess: ((ev: AudioProcessEvent) => void) | null;
}

export interface SourceNode {
  connect(node: unknown): void;
}

export interface GainNode {
  gain: { value: number };
  connect(node: unknown): void;
}

export interface AudioContextLike {
  readonly sampleRate: number;
  readonly destination: unknown;
  createMediaStreamSource(stream: MediaStream): SourceNode;
  createScriptProcessor(bufferSize: number, inputs: number, outputs: number): ProcessorNode;
  createGain(): GainNode;
}

export interface MediaDevicesLike {
  getUserMedia(constraints: unknown): Promise<MediaStream>;
}

export interface LiveCaptureDeps {
  mediaDevices: MediaDevicesLike;
  createContext(): AudioContextLike;
  sendAudio(stream: CaptureStream, pcm: Uint8Array, tsMs: number): void;
  setMicState(state: "granted" | "denied"): void;
  now(): number;
  /** The tab stream ended on its own (tab closed): the meeting is over. */
  onTabEnded?(): void;
  /** Abort = meeting over: stops every captured track (ends the tab capture, frees the mic). */
  signal?: AbortSignal;
}

/**
 * Adapter from a real AudioContext to the injectable AudioContextLike: it
 * bridges the strict DOM event types (AudioProcessingEvent) to the minimal
 * structural seam the orchestrator and its fakes share.
 */
export function adaptAudioContext(ctx: AudioContext): AudioContextLike {
  // Wrappers are handed back to the caller, which connects wrapper to
  // wrapper; the real AudioNode.connect only accepts real nodes ("Overload
  // resolution failed" live, 2026-10-31), so every connect unwraps first.
  const real = new WeakMap<object, AudioNode>();
  const unwrap = (target: unknown): AudioNode =>
    real.get(target as object) ?? (target as AudioNode);
  const wrap = <T extends object>(wrapper: T, node: AudioNode): T => {
    real.set(wrapper, node);
    return wrapper;
  };
  const wrapProcessor = (node: ScriptProcessorNode): ProcessorNode => wrap({
    connect: (target: unknown) => node.connect(unwrap(target)),
    get onaudioprocess(): ProcessorNode["onaudioprocess"] {
      return node.onaudioprocess as unknown as ProcessorNode["onaudioprocess"];
    },
    set onaudioprocess(fn: ProcessorNode["onaudioprocess"]) {
      node.onaudioprocess = fn ? (ev) => fn(ev) : null;
    },
  }, node);
  return {
    sampleRate: ctx.sampleRate,
    destination: ctx.destination,
    createMediaStreamSource: (stream: MediaStream) => {
      const source = ctx.createMediaStreamSource(stream);
      return wrap({ connect: (target: unknown) => source.connect(unwrap(target)) }, source);
    },
    createScriptProcessor: (bufferSize: number, inputs: number, outputs: number) =>
      wrapProcessor(ctx.createScriptProcessor(bufferSize, inputs, outputs)),
    createGain: () => {
      const gain = ctx.createGain();
      return wrap({
        gain: gain.gain,
        connect: (target: unknown) => gain.connect(unwrap(target)),
      }, gain);
    },
  };
}

function channelCountOf(stream: MediaStream): number {
  try {
    return stream.getAudioTracks()[0]?.getSettings().channelCount ?? 2;
  } catch {
    return 2;
  }
}

function pcmBytes(pcm: Int16Array): Uint8Array {
  return new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
}

export async function startLiveCapture(
  streamId: string | undefined,
  deps: LiveCaptureDeps,
  opts: { mic: boolean } = { mic: true },
): Promise<{ tab: boolean; mic: boolean }> {
  const result = { tab: false, mic: false };
  const tracks: MediaStreamTrack[] = [];
  // ponytail: tracks only; the AudioContext idles with no live source.
  const stopAll = (): void => { for (const t of tracks.splice(0)) t.stop(); };
  deps.signal?.addEventListener("abort", stopAll);
  let ctx: AudioContextLike;
  try {
    ctx = deps.createContext();
  } catch {
    return result; // no WebAudio: the meeting proceeds without live audio
  }

  const tap = (
    stream: MediaStream,
    kind: CaptureStream,
    replay: boolean,
  ): void => {
    tracks.push(...stream.getAudioTracks());
    if (deps.signal?.aborted) stopAll(); // the meeting ended while getUserMedia was pending
    const channels = channelCountOf(stream);
    const source = ctx.createMediaStreamSource(stream);
    if (replay) source.connect(ctx.destination); // the user keeps hearing the call
    const proc = ctx.createScriptProcessor(4096, channels, channels);
    const acc = new CaptureAccumulator(deps.now(), ctx.sampleRate);
    proc.onaudioprocess = (ev) => {
      const input: Float32Array[] = [];
      for (let c = 0; c < ev.inputBuffer.numberOfChannels; c += 1) {
        input.push(ev.inputBuffer.getChannelData(c));
      }
      for (const frame of acc.push(input)) {
        deps.sendAudio(kind, pcmBytes(frame.pcm), frame.ts_ms);
      }
    };
    source.connect(proc);
    const sink = ctx.createGain(); // keeps the processor running, adds no sound
    sink.gain.value = 0;
    proc.connect(sink);
    sink.connect(ctx.destination);
  };

  if (streamId !== undefined) {
    try {
      const tab = await deps.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
      });
      tap(tab, "tab", true);
      // "ended" fires when the source stops (tab closed), never on our own stop().
      tab.getAudioTracks()[0]?.addEventListener("ended", () => deps.onTabEnded?.());
      result.tab = true;
    } catch {
      // No tab audio (the Playwright rig has no capture device): the
      // meeting proceeds; the popup already warned at Start time.
    }
  }

  if (!opts.mic) return result;
  try {
    const mic = await deps.mediaDevices.getUserMedia({ audio: true });
    tap(mic, "mic", false);
    deps.setMicState("granted");
    // Unplugged or revoked mid-meeting: the popup must not keep saying "ready".
    mic.getAudioTracks()[0]?.addEventListener("ended", () => deps.setMicState("denied"));
    result.mic = true;
  } catch {
    deps.setMicState("denied"); // tab-only meeting; the popup shows it on reopen
  }

  return result;
}
