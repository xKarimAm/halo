// Platform-neutral MeetingAdapter interface (contracts-owned, TS only).
//
// extension/src/meet_adapter implements this for Google Meet, keyed on
// data-participant-id, never class names. Zoom/Teams web adapters are
// post-MVP roadmap items implementing the same interface. This module is
// the emitter of record for tiles.snapshot / speaker.active; meeting.started
// is sent by the hub at the Start click, never by an adapter.

import type {
  FacesUpdate,
  SpeakerActive,
  TileFrame,
  TilesSnapshotTiles,
} from "./gen/types";

/** One participant tile, as carried by tiles.snapshot. */
export type Tile = TilesSnapshotTiles;

/** Speaking-highlight change, as carried by speaker.active. */
export type SpeakingEvent = SpeakerActive;

/** In-tab frame handed Frame Source -> Face Detector (bitmap never serialises). */
export interface TileFrameMessage extends TileFrame {
  bitmap: ImageBitmap;
}

/** In-tab face result, Face Detector -> Overlay (null face means Frame mode). */
export type FacesUpdateMessage = FacesUpdate;

type Unsubscribe = () => void;

export interface MeetingAdapter {
  /** Platform id, e.g. "meet" (matches meeting.started.platform). */
  readonly platform: string;
  /** True when this adapter handles the given page URL. */
  matches(url: string): boolean;
  /** Current tiles (stable tile_id = data-participant-id). */
  tiles(): Tile[];
  /** Tiles changed (join/leave/layout); returns an unsubscribe function. */
  onTiles(cb: (tiles: Tile[]) => void): Unsubscribe;
  /** Speaking highlight changed for a tile. */
  onSpeaking(cb: (event: SpeakingEvent) => void): Unsubscribe;
  /** A participant joined (not a meeting lifecycle event). */
  onJoin(cb: (tile: Tile) => void): Unsubscribe;
  /** A participant left (not a meeting lifecycle event). */
  onLeave(cb: (tile: Tile) => void): Unsubscribe;
}
