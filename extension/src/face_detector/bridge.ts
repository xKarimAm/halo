// FaceBridge: per-tile hold/fallback policy between the detector and the
// Overlay. A single missed frame must not flip a tile to Frame mode (that
// would flicker bubbles between the head and the tile corner), but a tile
// with no face for a while must fall back to Frame mode. Policy, per tile:
// a face forwards at once; nulls inside FACE_HOLD_MS of the last face
// re-emit that face; nulls past NO_FACE_FALLBACK_MS emit one explicit
// face:null (Frame mode); the zone between is suppressed so the Overlay
// keeps showing the held face. A tile that never had a face emits its
// null once. Tiles beyond the pipeline's 6-tile cap stay silent.
import type { FacesUpdate } from "../../../contracts/ext/gen/types";
import { FacePipeline, type TileFrameLike } from "./detector";

/** Nulls this fresh still show the last face: anti-flicker. */
export const FACE_HOLD_MS = 500;
/** No face this long: the tile falls back to Frame mode. */
export const NO_FACE_FALLBACK_MS = 1000;

interface Track {
  lastFace: FacesUpdate["face"] | undefined;
  lastFaceTs: number;
  nulled: boolean;
}

export interface FaceBridgeOptions {
  pipeline?: FacePipeline;
  onUpdate: (update: FacesUpdate) => void;
  holdMs?: number;
  fallbackMs?: number;
}

export class FaceBridge {
  private readonly pipeline?: FacePipeline;
  private readonly onUpdate: (update: FacesUpdate) => void;
  private readonly holdMs: number;
  private readonly fallbackMs: number;
  private readonly tracks = new Map<string, Track>();

  constructor(options: FaceBridgeOptions) {
    this.pipeline = options.pipeline;
    this.onUpdate = options.onUpdate;
    this.holdMs = options.holdMs ?? FACE_HOLD_MS;
    this.fallbackMs = options.fallbackMs ?? NO_FACE_FALLBACK_MS;
  }

  /** Local-pipeline path (in-tab engine): detect, then apply the policy. */
  pushFrame(frame: TileFrameLike): void {
    if (!this.pipeline) return;
    const update = this.pipeline.process(frame);
    if (!update) return; // over the cap: silent, the tile stays Frame mode
    this.pushUpdate(update);
  }

  /** Remote-detector path (the face-detector iframe page): policy only. */
  pushUpdate(update: FacesUpdate): void {
    const track = this.tracked(update.tile_id);
    if (update.face) {
      track.lastFace = update.face;
      track.lastFaceTs = update.frame_ts_ms;
      track.nulled = false;
      this.onUpdate(update);
      return;
    }
    if (track.lastFace && update.frame_ts_ms - track.lastFaceTs <= this.holdMs) {
      this.onUpdate({ ...update, face: track.lastFace }); // hold: no flicker
      return;
    }
    if (!track.lastFace || update.frame_ts_ms - track.lastFaceTs > this.fallbackMs) {
      if (!track.nulled) {
        track.nulled = true;
        this.onUpdate(update); // explicit Frame mode, once per absence
      }
    }
    // Dead zone (hold..fallback): suppress; the Overlay keeps the held face.
  }

  private tracked(tileId: string): Track {
    let track = this.tracks.get(tileId);
    if (!track) {
      track = { lastFace: undefined, lastFaceTs: 0, nulled: false };
      this.tracks.set(tileId, track);
    }
    return track;
  }
}
