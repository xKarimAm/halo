// Face detector pipeline: engine-agnostic (contracts faces.update shape).
// One track per tile_id, EMA smoothing, at most 6 tiles tracked, a null
// face restarts smoothing (no sticky track). The box is never drawn/saved.
import type { FacesUpdate } from "../../../contracts/ext/gen/types";

export interface TileFrameLike {
  tile_id: string;
  ts_ms: number;
  frame_w: number;
  frame_h: number;
  bitmap?: unknown;
}

export interface Detection {
  box: number[]; // [x, y, w, h] 0..1 of the source frame
  conf: number;
  keypoints?: { x: number; y: number }[]; // eyes/nose when the engine gives them
}

export interface DetectorEngine {
  name: "mediapipe" | "yunet" | "sam";
  detect(frame: TileFrameLike): Detection | null;
}

export const MAX_TRACKED_TILES = 6;

export function iou(a: number[], b: number[]): number {
  const x = Math.max(a[0], b[0]);
  const y = Math.max(a[1], b[1]);
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - x;
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - y;
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / (a[2] * a[3] + b[2] * b[3] - inter);
}

function headAnchor(box: number[], keypoints?: { x: number; y: number }[]): [number, number] {
  if (keypoints && keypoints.length >= 3) {
    // eyes + nose: anchor just above the eye line's midpoint
    const xs = keypoints.slice(0, 3).map((k) => k.x);
    const ys = keypoints.slice(0, 3).map((k) => k.y);
    return [xs.reduce((s, v) => s + v, 0) / xs.length, Math.max(box[1], Math.min(...ys) - box[3] * 0.08)];
  }
  return [box[0] + box[2] / 2, box[1] + box[3] * 0.22]; // inside the top half
}

export class FacePipeline {
  private tracks = new Map<string, { box: number[] }>();
  private activeTiles: string[] = [];

  constructor(
    private engine: DetectorEngine,
    private alpha = 0.5, // EMA weight on the newest box
  ) {}

  /** Returns a faces.update, or null when the tile is beyond the 6-tile cap. */
  process(frame: TileFrameLike): FacesUpdate | null {
    if (!this.activeTiles.includes(frame.tile_id)) {
      if (this.activeTiles.length >= MAX_TRACKED_TILES) return null;
      this.activeTiles.push(frame.tile_id);
    }
    const det = this.engine.detect(frame);
    const base: FacesUpdate = {
      tile_id: frame.tile_id,
      frame_ts_ms: frame.ts_ms,
      engine: this.engine.name,
      space: { frame_w: frame.frame_w, frame_h: frame.frame_h },
      face: null,
    };
    if (!det) {
      this.tracks.delete(frame.tile_id); // no sticky track: return restarts smoothing
      return base;
    }
    const prev = this.tracks.get(frame.tile_id);
    const box = prev
      ? det.box.map((v, i) => this.alpha * v + (1 - this.alpha) * prev.box[i])
      : [...det.box];
    this.tracks.set(frame.tile_id, { box });
    return { ...base, face: { box, head_anchor: headAnchor(box, det.keypoints), conf: det.conf } };
  }
}
