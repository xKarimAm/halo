import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MODEL_ASSET } from "./mediapipe";

// The committed model must load as a valid TFLite flatbuffer. (The full
// MediaPipe WASM runtime needs a browser document, so runtime creation of
// the FaceDetector is an L3 concern; this test pins the asset itself.)
describe("bundled BlazeFace model", () => {
  const path = fileURLToPath(new URL(`./${MODEL_ASSET}`, import.meta.url));

  it("exists at the assets path the engine loads from", () => {
    expect(MODEL_ASSET).toBe("assets/blaze_face_short_range.tflite");
    expect(existsSync(path)).toBe(true);
  });

  it("loads as a valid TFLite model", () => {
    const buf = readFileSync(path);
    expect(buf.byteLength).toBeGreaterThan(200_000);
    // TFLite flatbuffer: u32 root-table offset, then the "TFL3" identifier.
    expect(buf.readUInt32LE(0)).toBeGreaterThan(0);
    expect(buf.readUInt32LE(0)).toBeLessThan(buf.byteLength);
    expect(buf.subarray(4, 8).toString("ascii")).toBe("TFL3");
    // The model's own graph names face/blaze tensors.
    const text = buf.toString("latin1");
    expect(text).toContain("blaze");
    expect(text).toContain("face");
  });
});
