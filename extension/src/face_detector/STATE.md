# face_detector: STATE

## Goal
Implement extension/src/face_detector per its PLAN.md; done ONLY when `npm --prefix extension test` passes and the contract tests for face_detector pass.

## Key decisions
- Engine-agnostic pipeline (contracts `faces.update` shape): a `DetectorEngine` seam (`detect(frame) -> box/conf/keypoints | null`), a per-tile tracker with EMA smoothing and no sticky track, a 6-tile cap, and head anchor in the box's top half. MediaPipe (`@mediapipe/tasks-vision`, BlazeFace short-range) is the default engine name; the unit tests run a stub engine behind the same shape (Done case 5).
- Tile track identity is per `tile_id` only; a face leaving and returning restarts smoothing (review answer in PLAN).
- The hidden-iframe entrypoint receives ImageBitmaps by postMessage and posts `faces.update` back; WASM/model assets are bundled with the extension (MV3 forbids remote code). If the probe fallback applies (no `<video>`), frame_source emits nothing and this module stays silent.

## Task graph
1. Tracker + pipeline (cap, smoothing, anchor, null handling).
2. MediaPipe engine adapter + bundled-asset wiring.
3. Iframe entrypoint (ImageBitmap in, faces.update out).
4. Vitest Done cases (1)-(5) with a stub engine + IoU helper for L3.

## File map
- `extension/src/face_detector/detector.ts`: engine seam, tracker, pipeline, IoU.
- `extension/src/face_detector/mediapipe.ts`: MediaPipe engine (bundled WASM/model).
- `extension/src/face_detector/detector.test.ts`: Done-case tests.
- `extension/src/face_detector/index.ts`: in-tab boot (frame subscription seam).
- `extension/src/entrypoints/face-detector/index.html` + `main.ts`: hidden iframe page.

## Current step
Review fix pushed: the BlazeFace model (`blaze_face_short_range.tflite`, 229,746 bytes) is committed at the assets path the engine loads from, with `model.test.ts` loading it as a valid TFLite (TFL3) model — 7 Vitest cases green, `tsc --noEmit` clean. Full MediaPipe WASM runtime creation needs a browser document, so it stays an L3 concern; Frame mode remains the fallback until then. Then rebased on main.

## Open questions
- L3 IoU ≥ 0.7 on CC0 faces painted by Fake Meet runs once frame_source + fake_meet merge with this module; the IoU helper and stub-engine cases here are the same math that spec asserts.
