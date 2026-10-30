// MediaPipe engine (MVP default): BlazeFace short-range via
// @mediapipe/tasks-vision, WASM + model bundled in the extension (MV3
// forbids remote code). The model binary lives at
// assets/blaze_face_short_range.tflite next to this module; if it cannot
// load, detect() returns null and the Overlay uses Frame mode (the locked
// probe fallback) instead of breaking the tab.
import type { Detection, DetectorEngine, TileFrameLike } from "./detector";

export const MODEL_ASSET = "assets/blaze_face_short_range.tflite";
export const WASM_ASSET = "assets/wasm";

interface MpDetection {
  boundingBox?: { originX: number; originY: number; width: number; height: number };
  categories?: { score: number }[];
  keypoints?: { x: number; y: number }[];
}
interface MpDetector {
  detect(input: unknown): { detections: MpDetection[] };
}

export class MediaPipeEngine implements DetectorEngine {
  readonly name = "mediapipe" as const;
  private detector: MpDetector | null = null;
  private failed = false;

  /** Lazy init: FilesetResolver + FaceDetector from the bundled assets. */
  async init(wasmPath = WASM_ASSET, modelPath = MODEL_ASSET): Promise<boolean> {
    if (this.detector) return true;
    if (this.failed) return false;
    try {
      const vision = await import("@mediapipe/tasks-vision");
      const fileset = await vision.FilesetResolver.forVisionTasks(wasmPath);
      this.detector = (await vision.FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelPath },
        runningMode: "IMAGE",
      })) as unknown as MpDetector;
      return true;
    } catch {
      this.failed = true; // missing/unloadable model: Frame mode everywhere
      return false;
    }
  }

  detect(frame: TileFrameLike): Detection | null {
    if (!this.detector || !frame.bitmap) return null;
    const result = this.detector.detect(frame.bitmap);
    const first = result.detections[0];
    if (!first?.boundingBox) return null;
    const bb = first.boundingBox;
    return {
      box: [
        bb.originX / frame.frame_w, bb.originY / frame.frame_h,
        bb.width / frame.frame_w, bb.height / frame.frame_h,
      ],
      conf: first.categories?.[0]?.score ?? 0,
      keypoints: first.keypoints,
    };
  }
}
