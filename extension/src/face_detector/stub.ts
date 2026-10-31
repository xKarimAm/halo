// StubFaceEngine: TEST-ONLY deterministic detector behind the same
// faces.update shape. Returns the Fake Meet fixture's painted-truth boxes
// (rig/fake_meet/fixture.js) so the L3 face-mode spec can assert the full
// wiring (FrameSource -> detector page -> bridge -> Overlay bubble) without
// a real ML runtime. Active only behind the ?halo_face_stub=1 hook, in the
// iframe entrypoint and the in-tab boot; the default path always uses
// MediaPipeEngine. The truth values are duplicated here on purpose: the
// detector page cannot read the Fake Meet page's JS fixture.
import type { Detection, DetectorEngine, TileFrameLike } from "./detector";

/** Painted-truth boxes [x, y, w, h] in 0..1 of the source frame, by tile. */
export const STUB_FACE_BOXES: Record<string, number[]> = {
  "spaces/x/devices/1": [0.38, 0.18, 0.24, 0.42],
  "spaces/x/devices/2": [0.4, 0.2, 0.22, 0.4],
};

export class StubFaceEngine implements DetectorEngine {
  // Reports "mediapipe" on purpose: the stub stands in for the production
  // engine, so downstream shape asserts see the production value.
  readonly name = "mediapipe" as const;
  detect(frame: TileFrameLike): Detection | null {
    const box = STUB_FACE_BOXES[frame.tile_id];
    if (!box) return null; // no-face tile (e.g. Sam): stays Frame mode
    return { box: [...box], conf: 0.99 };
  }
}
