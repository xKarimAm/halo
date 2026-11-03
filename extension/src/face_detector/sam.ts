// Halo mode on SAM 3.1 (Meta, open weights; Karim 2026-11-02): the speaking
// tile's frame goes, about 4 times a second, from the Meet tab through the
// hub to the local SAM worker (packaging/sam_worker.py, 127.0.0.1:8766), and
// the face box comes back as faces.update for the Overlay. Frames stay on
// this PC. No worker, no hub, or no face: the Overlay stays in Frame mode.
import type { FacesUpdate } from "../../../contracts/ext/gen/types";

export const SAM_PORT_NAME = "halo-sam";
export const SAM_WORKER_URL = "http://127.0.0.1:8766/faces";

type Face = FacesUpdate["face"];

export interface SamFaceSourceOptions {
  speakingTile: () => string | null;
  video: (tileId: string) => HTMLVideoElement | null;
  /** The video frame as a base64 JPEG, scaled to `width`. */
  encode: (video: HTMLVideoElement, width: number) => Promise<string>;
  /** The worker's face, or "error" (no hub, no worker, timeout). */
  detect: (jpegB64: string) => Promise<Face | "error">;
  onFaces: (update: FacesUpdate) => void;
  now?: () => number;
  width?: number;
  backoffMs?: number;
}

/** One frame in flight at a time, always the newest; an error pauses tries. */
export class SamFaceSource {
  private busy = false;
  private pausedUntil = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;

  constructor(private readonly o: SamFaceSourceOptions) {
    this.now = o.now ?? (() => Date.now());
  }

  start(intervalMs = 100): void {
    if (this.timer === null) this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  async tick(): Promise<void> {
    if (this.busy || this.now() < this.pausedUntil) return;
    const tileId = this.o.speakingTile();
    const video = tileId ? this.o.video(tileId) : null;
    if (!tileId || !video || video.videoWidth <= 0 || video.videoHeight <= 0) return;
    this.busy = true;
    const ts = this.now();
    try {
      const face = await this.o.detect(await this.o.encode(video, this.o.width ?? 480));
      if (face === "error") {
        this.pausedUntil = this.now() + (this.o.backoffMs ?? 10_000);
        return;
      }
      this.o.onFaces({
        tile_id: tileId, frame_ts_ms: ts, engine: "sam",
        space: { frame_w: video.videoWidth, frame_h: video.videoHeight }, face,
      });
    } catch {
      this.pausedUntil = this.now() + (this.o.backoffMs ?? 10_000);
    } finally {
      this.busy = false;
    }
  }
}

/** Production encoder: the frame drawn small, JPEG quality 0.7. */
export async function encodeJpeg(video: HTMLVideoElement, width: number): Promise<string> {
  const h = Math.round((width * video.videoHeight) / video.videoWidth);
  const canvas = new OffscreenCanvas(width, h);
  canvas.getContext("2d")!.drawImage(video, 0, 0, width, h);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg", quality: 0.7 })).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

interface PortLike {
  postMessage(msg: unknown): void;
  onMessage: { addListener(fn: (msg: unknown) => void): void };
  onDisconnect: { addListener(fn: () => void): void };
}

/** Content-script side: requests over the "halo-sam" Port, 2 s timeout each. */
export function createSamDetect(connect: () => PortLike, timeoutMs = 2000): (jpegB64: string) => Promise<Face | "error"> {
  let port: PortLike | null = null;
  let nextId = 0;
  const pending = new Map<number, (r: Face | "error") => void>();
  const open = (): PortLike => {
    const p = connect();
    p.onMessage.addListener((msg) => {
      const m = msg as { id?: number; face?: Face; error?: string };
      const done = typeof m.id === "number" ? pending.get(m.id) : undefined;
      if (!done) return;
      pending.delete(m.id!);
      done(m.error ? "error" : (m.face ?? null));
    });
    p.onDisconnect.addListener(() => {
      if (port === p) port = null;
      for (const done of pending.values()) done("error");
      pending.clear();
    });
    return p;
  };
  return (jpegB64) => new Promise((resolve) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); resolve("error"); }, timeoutMs);
    pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
    try {
      port = port ?? open();
      port.postMessage({ id, jpeg: jpegB64 });
    } catch {
      pending.delete(id);
      clearTimeout(timer);
      port = null;
      resolve("error"); // no hub yet (before Start)
    }
  });
}

/** Hub side: forward each frame to the worker and answer on the same Port. */
export function serveSamPort(port: PortLike, fetchFn: typeof fetch = fetch): void {
  port.onMessage.addListener(async (msg) => {
    const m = msg as { id?: unknown; jpeg?: unknown };
    if (typeof m.id !== "number" || typeof m.jpeg !== "string") return;
    try {
      const bytes = Uint8Array.from(atob(m.jpeg), (c) => c.charCodeAt(0));
      const res = await fetchFn(SAM_WORKER_URL, { method: "POST", body: bytes, headers: { "Content-Type": "image/jpeg" } });
      if (!res.ok) throw new Error(`worker ${res.status}`);
      port.postMessage({ id: m.id, face: ((await res.json()) as { face: Face }).face ?? null });
    } catch {
      port.postMessage({ id: m.id, error: "sam worker unavailable" });
    }
  });
}
