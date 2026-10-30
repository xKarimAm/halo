/**
 * Frame Source: in-tab only. Draws each tile's `<video>` to a canvas at
 * ~10 fps and hands `TileFrame`s to the Face Detector. Face frames never
 * leave the browser and never cross the wire. If there is no `<video>`
 * (canvas-only tiles, or the probe finds none), this module emits nothing
 * and every tile uses Frame mode downstream.
 *
 * This module never touches the Port or the socket.
 */

export interface FrameTileInput {
  tile_id: string;
  /** Null for canvas-only tiles: skipped silently. */
  video: HTMLVideoElement | null;
}

/** In-tab frame: `TileFrame` fields plus the bitmap (never serialised). */
export interface TileFrameOut {
  tile_id: string;
  ts_ms: number;
  bitmap: ImageBitmap;
  frame_w: number;
  frame_h: number;
}

/**
 * One reusable canvas per tracked tile. Production passes an OffscreenCanvas
 * wrapper; `transferBitmap` must transfer (zero-copy), not copy.
 */
export interface FrameCanvas {
  width: number;
  height: number;
  drawVideo(video: HTMLVideoElement): void;
  transferBitmap(): ImageBitmap;
}

export interface FrameSourceOptions {
  /**
   * Tiles in snapshot order with their `<video>` refs (in-tab call into the
   * Meet Adapter: `adapter.tiles()` joined to each tile root's video).
   */
  listTiles: () => FrameTileInput[];
  onFrame: (frame: TileFrameOut) => void;
  createCanvas: (w: number, h: number) => FrameCanvas;
  /** Frames per second. Defaults to 10. */
  fps?: number;
  /** Max tiles tracked. Defaults to 6 (first 6 by snapshot order). */
  maxTiles?: number;
  now?: () => number;
}

/** Production canvas factory over OffscreenCanvas. */
export function offscreenCanvasFactory(w: number, h: number): FrameCanvas {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("FrameSource: 2d context unavailable");
  }
  return {
    width: w,
    height: h,
    drawVideo: (video: HTMLVideoElement) => {
      ctx.drawImage(video, 0, 0, w, h);
    },
    transferBitmap: () => canvas.transferToImageBitmap(),
  };
}

export class FrameSource {
  private readonly listTiles: () => FrameTileInput[];
  private readonly onFrame: (frame: TileFrameOut) => void;
  private readonly createCanvas: (w: number, h: number) => FrameCanvas;
  private readonly intervalMs: number;
  private readonly maxTiles: number;
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly canvases = new Map<string, { key: string; canvas: FrameCanvas }>();

  constructor(options: FrameSourceOptions) {
    this.listTiles = options.listTiles;
    this.onFrame = options.onFrame;
    this.createCanvas = options.createCanvas;
    this.intervalMs = 1000 / (options.fps ?? 10);
    this.maxTiles = options.maxTiles ?? 6;
    this.now = options.now ?? (() => Date.now());
  }

  start(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.canvases.clear();
  }

  private tick(): void {
    const tsMs = this.now();
    const tiles = this.listTiles().slice(0, this.maxTiles);
    const live = new Set<string>();
    for (const tile of tiles) {
      if (!tile.video) {
        continue;
      }
      const frameW = tile.video.videoWidth;
      const frameH = tile.video.videoHeight;
      if (frameW <= 0 || frameH <= 0) {
        continue;
      }
      live.add(tile.tile_id);
      const key = `${frameW}x${frameH}`;
      let entry = this.canvases.get(tile.tile_id);
      if (!entry || entry.key !== key) {
        entry = { key, canvas: this.createCanvas(frameW, frameH) };
        this.canvases.set(tile.tile_id, entry);
      }
      entry.canvas.drawVideo(tile.video);
      this.onFrame({
        tile_id: tile.tile_id,
        ts_ms: tsMs,
        bitmap: entry.canvas.transferBitmap(),
        frame_w: frameW,
        frame_h: frameH,
      });
    }
    for (const id of [...this.canvases.keys()]) {
      if (!live.has(id)) {
        this.canvases.delete(id);
      }
    }
  }
}
