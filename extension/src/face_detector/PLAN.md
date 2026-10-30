# face_detector: PLAN

## Job
Wave 3 (W3, **Nov 1 late, or Nov 2 morning** — last in the W3 order: rig (Oct 31 night) → `hub_capture` → `overlay` in Frame mode → this module; the thin run needs no Face Detector and Face mode is a Nov 2 goal). Critical path; the main face path. MediaPipe Face Detector (`@mediapipe/tasks-vision`, BlazeFace short-range; WASM + model bundled in the extension — MV3 forbids remote code), ~1–2 ms per tile, running in a Worker inside a hidden extension iframe (own origin + CSP); the content script transfers ImageBitmaps to it. Smooths boxes, one track per tile, head anchor from eye/nose key points. No face, or tiles beyond 6 → Frame mode. The contract is engine-agnostic so SAM 3.1 could plug in later as `engine: "sam"`; SAM itself gets no PLAN (✂1 stretch). The face box is never drawn and never saved (OVERLAY-UX §9).

## Inputs (contracts consumed)
`TileFrame` from Frame Source (in-tab, transferred ImageBitmaps).

## Outputs (contracts emitted)
`faces.update {tile_id, frame_ts_ms, engine: "mediapipe"|"yunet"|"sam", space: {frame_w, frame_h}, face: {box: [x,y,w,h] 0..1 of the source frame, head_anchor: [x,y], conf} | null}` — in-tab only, every frame, no envelope, no ACK. `null` → the Overlay uses Frame mode for that tile.

## Lane (the files it owns)
`extension/src/face_detector/**` (+ tests, bundled model/WASM assets). Entry wrapper: the face-detector iframe page (`extension/src/entrypoints/` wrapper owned by this module; `wasm-unsafe-eval` CSP + manifest wiring owned by `hub_capture`).

## Depends on
`contracts` (`faces.update` shape), `frame_source`. Probe gate: no `<video>` ⇒ emit nothing (locked fallback).

## Fakes it tests with
CC0 photo faces painted by the Fake Meet page (known ground-truth boxes); no real faces in the repo.

## Done = tests
Run: `npm --prefix extension test`; L3 `npm --prefix rig/fake_meet test`. Concrete cases (diagram box: CC0 photo faces on Fake Meet, IoU ≥ 0.7): (1) each CC0 face yields a box with IoU ≥ 0.7 vs painted truth and a head anchor inside the box's top half. (2) A tile with no face → `face: null`, and back to a box when a face appears (no sticky track). (3) Seven tiles → updates for at most 6 tiles. (4) Smoothing: a jittering ground-truth face (±2 px painted jitter) produces a box that never jumps more than the painted motion per frame in the L3 trace. (5) Engine field is `mediapipe` in the MVP; swapping the engine behind the same shape needs no Overlay change (unit test with a stub engine).

## Cut line
✂1 SAM 3.1 stretch is the plug this module must not break — and the first thing cut overall. MediaPipe itself is never cut while Face mode lives; if the meet-overlay probe finds no `<video>`, this module ships silent (Frame mode everywhere) by the locked fallback.

## Doubts
Answered: engine-agnostic shape, bundle-not-CDN (DECISIONS §3 defaults). Answered (review): tile track identity is per `tile_id` only (no face re-identification across tiles); a face leaving and returning restarts smoothing rather than resuming an old track.
