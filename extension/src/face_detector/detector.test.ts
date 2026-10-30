import { describe, expect, it } from "vitest";
import {
  FacePipeline,
  iou,
  type Detection,
  type DetectorEngine,
  type TileFrameLike,
} from "./detector";

function stubEngine(name: string, results: (Detection | null)[]): DetectorEngine {
  let i = 0;
  return { name: name as DetectorEngine["name"], detect: () => results[Math.min(i++, results.length - 1)] };
}
const frame = (tile_id: string, ts_ms = 0): TileFrameLike => ({ tile_id, ts_ms, frame_w: 640, frame_h: 360 });
const box = [0.38, 0.18, 0.24, 0.42];

// (1) box IoU >= 0.7 vs truth, anchor inside the top half
describe("detection", () => {
  it("emits a faces.update matching painted truth with a head anchor up top", () => {
    const pipe = new FacePipeline(stubEngine("mediapipe", [{ box, conf: 0.9 }]));
    const out = pipe.process(frame("t1"))!;
    expect(out.engine).toBe("mediapipe");
    expect(out.space).toEqual({ frame_w: 640, frame_h: 360 });
    expect(iou(out.face!.box, box)).toBeGreaterThanOrEqual(0.7);
    const [ax, ay] = out.face!.head_anchor;
    expect(ax).toBeGreaterThanOrEqual(box[0]);
    expect(ax).toBeLessThanOrEqual(box[0] + box[2]);
    expect(ay).toBeGreaterThanOrEqual(box[1]);
    expect(ay).toBeLessThanOrEqual(box[1] + box[3] / 2);
  });

  // (2) no face -> null, and back to a box without a sticky track
  it("null when no face, fresh (unsmoothed) box when a face returns", () => {
    const moved: Detection = { box: [0.1, 0.1, 0.2, 0.4], conf: 0.9 };
    const pipe = new FacePipeline(stubEngine("mediapipe", [{ box, conf: 0.9 }, null, moved]));
    expect(pipe.process(frame("t1"))!.face).not.toBeNull();
    expect(pipe.process(frame("t1"))!.face).toBeNull();
    const back = pipe.process(frame("t1"))!;
    expect(back.face!.box).toEqual(moved.box); // smoothing restarted, not blended
  });

  // (3) seven tiles -> updates for at most 6
  it("caps updates at 6 tiles", () => {
    const pipe = new FacePipeline(stubEngine("mediapipe", [{ box, conf: 0.9 }]));
    const outs = ["t1", "t2", "t3", "t4", "t5", "t6", "t7"].map((t) => pipe.process(frame(t)));
    expect(outs.filter(Boolean)).toHaveLength(6);
    expect(outs[6]).toBeNull();
  });

  // (4) smoothing: jittering truth yields smaller per-frame motion
  it("smoothing never jumps more than the painted motion per frame", () => {
    const jitter = [0.38, 0.382, 0.378, 0.381].map((x) => ({ box: [x, 0.18, 0.24, 0.42], conf: 0.9 }));
    const pipe = new FacePipeline(stubEngine("mediapipe", jitter), 0.5);
    let prev: number[] | null = null;
    for (let i = 0; i < jitter.length; i++) {
      const out = pipe.process(frame("t1", i * 100))!;
      if (prev) {
        const painted = Math.abs(jitter[i].box[0] - jitter[i - 1].box[0]);
        expect(Math.abs(out.face!.box[0] - prev[0])).toBeLessThanOrEqual(painted + 1e-9);
      }
      prev = out.face!.box;
    }
  });

  // (5) engine swap behind the same shape needs no consumer change
  it("a stub engine swap keeps the faces.update shape", () => {
    const pipe = new FacePipeline(stubEngine("yunet", [{ box, conf: 0.5 }]));
    const out = pipe.process(frame("t1"))!;
    expect(out.engine).toBe("yunet");
    expect(Object.keys(out).sort()).toEqual(["engine", "face", "frame_ts_ms", "space", "tile_id"]);
    expect(iou(box, box)).toBe(1);
    expect(iou(box, [0, 0, 0.1, 0.1])).toBe(0);
  });
});
