// In-tab boot (called by the hub content wrapper / frame_source seam):
// runs TileFrames through the pipeline and hands faces.update to the
// Overlay. Frames arrive as transferred ImageBitmaps in production; the
// seam here is the same shape the unit tests drive.
import { FacePipeline, type TileFrameLike } from "./detector";
import { MediaPipeEngine } from "./mediapipe";
import type { FacesUpdate } from "../../../contracts/ext/gen/types";

export function boot(context: {
  onFacesUpdate?: (update: FacesUpdate) => void;
}): { pushFrame(frame: TileFrameLike): void; pipeline: FacePipeline } {
  const pipeline = new FacePipeline(new MediaPipeEngine());
  return {
    pipeline,
    pushFrame(frame: TileFrameLike): void {
      const update = pipeline.process(frame);
      if (update) context.onFacesUpdate?.(update);
    },
  };
}
