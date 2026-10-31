import { describe, expect, it } from "vitest";
import { FaceBridge } from "./bridge";
import { FacePipeline, type Detection, type DetectorEngine } from "./detector";
import type { FacesUpdate } from "../../../contracts/ext/gen/types";

function stubEngine(results: (Detection | null)[]): DetectorEngine {
  let i = 0;
  return {
    name: "mediapipe",
    detect: () => results[Math.min(i++, results.length - 1)],
  };
}

const BOX = [0.38, 0.18, 0.24, 0.42];
const frame = (tile_id: string, ts_ms: number) => ({ tile_id, ts_ms, frame_w: 640, frame_h: 360 });

function collect(pipe: FacePipeline, holdMs = 500, fallbackMs = 1000) {
  const updates: FacesUpdate[] = [];
  const bridge = new FaceBridge({ pipeline: pipe, onUpdate: (u) => updates.push(u), holdMs, fallbackMs });
  return { updates, bridge };
}

describe("FaceBridge hold (no flicker)", () => {
  it("re-emits the last face on brief nulls, then falls back to null after >1 s", () => {
    const pipe = new FacePipeline(stubEngine([{ box: BOX, conf: 0.9 }, null]));
    const { updates, bridge } = collect(pipe);
    bridge.pushFrame(frame("t1", 0)); // face
    expect(updates).toHaveLength(1);
    expect(updates[0].face).not.toBeNull();

    bridge.pushFrame(frame("t1", 100)); // single-frame miss: hold the face
    bridge.pushFrame(frame("t1", 400)); // still inside the 500 ms hold
    expect(updates).toHaveLength(3);
    expect(updates[1].face!.box).toEqual(BOX);
    expect(updates[2].face!.box).toEqual(BOX);

    bridge.pushFrame(frame("t1", 700)); // dead zone: suppress, overlay keeps the held face
    expect(updates).toHaveLength(3);

    bridge.pushFrame(frame("t1", 1100)); // >1 s with no face: explicit Frame mode
    expect(updates).toHaveLength(4);
    expect(updates[3].face).toBeNull();

    bridge.pushFrame(frame("t1", 1500)); // stays null: no repeat spam
    expect(updates).toHaveLength(4);
  });

  it("emits an explicit null once for a tile that never had a face", () => {
    const pipe = new FacePipeline(stubEngine([null]));
    const { updates, bridge } = collect(pipe);
    bridge.pushFrame(frame("t9", 0));
    expect(updates).toHaveLength(1);
    expect(updates[0].face).toBeNull();
    bridge.pushFrame(frame("t9", 2000));
    expect(updates).toHaveLength(1);
  });

  it("a returning face lands immediately (no sticky null)", () => {
    const pipe = new FacePipeline(
      stubEngine([{ box: BOX, conf: 0.9 }, null, { box: BOX, conf: 0.9 }]),
    );
    const { updates, bridge } = collect(pipe);
    bridge.pushFrame(frame("t1", 0));
    bridge.pushFrame(frame("t1", 2000)); // null after fallback: explicit null
    expect(updates.at(-1)!.face).toBeNull();
    bridge.pushFrame(frame("t1", 2100)); // face back: immediate Face mode
    expect(updates.at(-1)!.face).not.toBeNull();
  });
});

describe("FaceBridge policy entry", () => {
  it("pushUpdate applies the same hold/fallback to remote (iframe) updates", () => {
    const pipe = new FacePipeline(stubEngine([null]));
    const { updates, bridge } = collect(pipe);
    const base: FacesUpdate = {
      tile_id: "t2", frame_ts_ms: 0, engine: "mediapipe",
      space: { frame_w: 640, frame_h: 360 },
      face: { box: BOX, head_anchor: [0.5, 0.3], conf: 0.9 },
    };
    bridge.pushUpdate(base);
    bridge.pushUpdate({ ...base, frame_ts_ms: 300, face: null });
    expect(updates).toHaveLength(2);
    expect(updates[1].face!.box).toEqual(BOX); // held
    bridge.pushUpdate({ ...base, frame_ts_ms: 1500, face: null });
    expect(updates).toHaveLength(3);
    expect(updates[2].face).toBeNull();
  });

  it("stays silent for tiles beyond the 6-tile cap", () => {
    const pipe = new FacePipeline(stubEngine([{ box: BOX, conf: 0.9 }]));
    const { updates, bridge } = collect(pipe);
    for (let i = 1; i <= 6; i += 1) bridge.pushFrame(frame(`t${i}`, 0));
    expect(updates).toHaveLength(6);
    bridge.pushFrame(frame("t7", 0));
    bridge.pushFrame(frame("t7", 5000)); // even past the fallback: nothing, stays Frame mode
    expect(updates).toHaveLength(6);
  });

  it("tracks hold/fallback per tile independently", () => {
    let mode: Detection | null = { box: BOX, conf: 0.9 };
    const engine: DetectorEngine = { name: "mediapipe", detect: () => mode };
    const { updates, bridge } = collect(new FacePipeline(engine));
    bridge.pushFrame(frame("a", 0)); // face on a
    bridge.pushFrame(frame("b", 0)); // face on b
    mode = null;
    bridge.pushFrame(frame("a", 2000)); // a goes null past fallback
    expect(updates.filter((u) => u.tile_id === "a").at(-1)!.face).toBeNull();
    bridge.pushFrame(frame("b", 300)); // b still inside its hold
    expect(updates.filter((u) => u.tile_id === "b").at(-1)!.face).not.toBeNull();
  });
});
