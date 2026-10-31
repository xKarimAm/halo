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
Face-mode wiring (verification gate 5): `bridge.ts` (FaceBridge: 500 ms hold re-emits the last face, >1 s absence emits one explicit face:null, per-tile, silent over the 6-tile cap), `host.ts` (hidden-iframe host: transfer posts, faces.update reply filter, dispose), `stub.ts` (TEST-ONLY StubFaceEngine with the Fake Meet truth boxes, ?halo_face_stub=1 only), `index.ts` boot extended (engine/hold/fallback options, backward compatible), iframe `main.ts` stub hook. 19 Vitest cases green (12 new), `tsc --noEmit` clean.

## Open questions
- L3 IoU ≥ 0.7 on CC0 faces painted by Fake Meet runs once frame_source + fake_meet merge with this module; the IoU helper and stub-engine cases here are the same math that spec asserts.
