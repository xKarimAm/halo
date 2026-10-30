# Bundled detector assets

`blaze_face_short_range.task` (BlazeFace short-range, float16) belongs in
this folder, next to a `wasm/` copy of the `@mediapipe/tasks-vision` WASM
fileset, so the extension never loads remote code (MV3). The MediaPipe
engine (`../mediapipe.ts`) reads `assets/blaze_face_short_range.task` and
`assets/wasm` relative to the extension root at runtime.

The model binary is not committed by the build that introduced this
module: its download was blocked in that sandbox (TLS/404 to Google
Storage). Drop the file here once and Face mode turns on; until then
`detect()` returns null and every tile uses Frame mode, which is the
locked probe fallback (DECISIONS section 3).
