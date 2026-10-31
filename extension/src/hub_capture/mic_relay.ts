// Mic relay: the Meet content script captures the mic (stream 1) and ships
// each 100 ms PCM16 frame to the offscreen hub over a "halo-mic" runtime
// Port. Extension messaging is JSON, so the bytes travel as a number array.
// The hub page may not exist yet at Start (the worker creates it), so the
// sender reconnects on the next frame after a dead Port; frames sent while
// no hub listens are dropped, like any audio before pair.ok.

export const MIC_PORT_NAME = "halo-mic";
export const MIC_START_MESSAGE = "halo/mic.start";

export interface MicFrameMessage {
  type: "halo/mic.frame";
  pcm: number[];
  ts: number;
}

interface PortLike {
  postMessage(msg: unknown): void;
  onDisconnect: { addListener(fn: () => void): void };
}

/** Content-script side: returns a sendAudio for startLiveCapture. */
export function createMicSender(connect: () => PortLike): (pcm: Uint8Array, tsMs: number) => void {
  let port: PortLike | null = null;
  return (pcm, tsMs) => {
    try {
      if (!port) {
        const next = connect();
        next.onDisconnect.addListener(() => {
          if (port === next) port = null;
        });
        port = next;
      }
      const msg: MicFrameMessage = { type: "halo/mic.frame", pcm: Array.from(pcm), ts: tsMs };
      port.postMessage(msg);
    } catch {
      port = null; // dead Port (no hub yet, or extension reloaded): retry next frame
    }
  };
}

/** Hub side: unpacks one relayed frame for hub.sendAudio("mic", ...). */
export function readMicFrame(msg: unknown): { pcm: Uint8Array; ts: number } | null {
  const m = msg as Partial<MicFrameMessage> | null;
  if (m?.type !== "halo/mic.frame" || !Array.isArray(m.pcm) || typeof m.ts !== "number") return null;
  return { pcm: Uint8Array.from(m.pcm), ts: m.ts };
}
