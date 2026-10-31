// In-tab boot (called by the hub content wrapper / frame_source seam):
// runs TileFrames through the pipeline + hold/fallback bridge and hands
// faces.update to the Overlay. Frames arrive as transferred ImageBitmaps in
// production; the seam here is the same shape the unit tests drive. The
// default engine is MediaPipe; the ?halo_face_stub=1 hook passes the stub.
import { FaceBridge } from "./bridge";
import { FacePipeline, type DetectorEngine, type TileFrameLike } from "./detector";
import { MediaPipeEngine } from "./mediapipe";
import type { FacesUpdate } from "../../../contracts/ext/gen/types";

export function boot(context: {
  onFacesUpdate?: (update: FacesUpdate) => void;
  engine?: DetectorEngine;
  holdMs?: number;
  fallbackMs?: number;
}): {
  pushFrame(frame: TileFrameLike): void;
  pipeline: FacePipeline;
  bridge: FaceBridge;
} {
  const pipeline = new FacePipeline(context.engine ?? new MediaPipeEngine());
  const bridge = new FaceBridge({
    pipeline,
    onUpdate: (update) => context.onFacesUpdate?.(update),
    holdMs: context.holdMs,
    fallbackMs: context.fallbackMs,
  });
  return {
    pipeline,
    bridge,
    pushFrame(frame: TileFrameLike): void {
      bridge.pushFrame(frame);
    },
  };
}
