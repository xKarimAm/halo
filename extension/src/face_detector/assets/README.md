# Bundled detector assets

`blaze_face_short_range.tflite` (BlazeFace short-range) is committed here,
next to where the MediaPipe engine (`../mediapipe.ts`, `MODEL_ASSET`)
expects it, so the extension never loads remote code (MV3). The WASM
fileset comes from the installed `@mediapipe/tasks-vision` package
(`node_modules/@mediapipe/tasks-vision/wasm`) at build time.

`model.test.ts` in this module loads the committed binary and checks it
is a valid TFLite model (TFL3 flatbuffer). The full MediaPipe runtime
load (WASM + FaceDetector) needs a browser document, so it runs in the
L3 Fake Meet harness rather than in Node unit tests; until the model
loads there, `detect()` returns null and tiles use Frame mode, the
locked probe fallback (DECISIONS section 3).
