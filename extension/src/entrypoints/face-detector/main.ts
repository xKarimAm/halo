// Hidden extension iframe (own origin + CSP): receives ImageBitmaps from
// the Meet content script and posts faces.update back. The face box is
// never drawn and never saved (OVERLAY-UX section 9).
import { FacePipeline } from "../../face_detector/detector";
import { MediaPipeEngine } from "../../face_detector/mediapipe";

const engine = new MediaPipeEngine();
const pipeline = new FacePipeline(engine);
void engine.init();

window.addEventListener("message", (ev: MessageEvent) => {
  const frame = ev.data as { tile_id?: string; ts_ms?: number; frame_w?: number; frame_h?: number; bitmap?: ImageBitmap };
  if (!frame || typeof frame.tile_id !== "string") return;
  const update = pipeline.process({
    tile_id: frame.tile_id,
    ts_ms: frame.ts_ms ?? 0,
    frame_w: frame.frame_w ?? frame.bitmap?.width ?? 0,
    frame_h: frame.frame_h ?? frame.bitmap?.height ?? 0,
    bitmap: frame.bitmap,
  });
  if (update) (ev.source as Window | null)?.postMessage(update, "*");
});
