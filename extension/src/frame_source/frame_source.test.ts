import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FrameSource,
  type FrameCanvas,
  type FrameTileInput,
  type TileFrameOut,
} from "./frame_source";

interface FakeBitmap {
  marker: string;
  transferred: boolean;
}

function fakeVideo(w: number, h: number): HTMLVideoElement {
  return { videoWidth: w, videoHeight: h } as HTMLVideoElement;
}

function makeCanvasFactory(drawn: { video: unknown; w: number; h: number }[]) {
  const created: FrameCanvas[] = [];
  const createCanvas = vi.fn((w: number, h: number): FrameCanvas => {
    const bitmaps: FakeBitmap[] = [];
    const canvas: FrameCanvas = {
      width: w,
      height: h,
      drawVideo: (video: HTMLVideoElement) => {
        drawn.push({ video, w, h });
      },
      transferBitmap: () => {
        const bitmap: FakeBitmap = { marker: `${w}x${h}`, transferred: true };
        bitmaps.push(bitmap);
        return bitmap as unknown as ImageBitmap;
      },
    };
    created.push(canvas);
    return canvas;
  });
  return { createCanvas, created };
}

function sevenTiles(): FrameTileInput[] {
  return Array.from({ length: 7 }, (_, index) => ({
    tile_id: `id-${index + 1}`,
    video: fakeVideo(640, 360),
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("frame emission", () => {
  it("yields TileFrames at ~10 fps with real frame dims and monotonic ts", () => {
    let now = 1760000000000;
    const drawn: { video: unknown; w: number; h: number }[] = [];
    const { createCanvas } = makeCanvasFactory(drawn);
    const frames: TileFrameOut[] = [];
    const source = new FrameSource({
      listTiles: () => [{ tile_id: "id-1", video: fakeVideo(1280, 720) }],
      onFrame: (frame) => frames.push(frame),
      createCanvas,
      now: () => now,
    });
    source.start();
    now += 100;
    vi.advanceTimersByTime(100);
    now += 100;
    vi.advanceTimersByTime(100);
    source.stop();
    expect(frames.length).toBeGreaterThanOrEqual(2);
    for (const frame of frames) {
      expect(frame.tile_id).toBe("id-1");
      expect(frame.frame_w).toBe(1280);
      expect(frame.frame_h).toBe(720);
    }
    const stamps = frames.map((frame) => frame.ts_ms);
    expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
    expect(drawn.length).toBe(frames.length);
  });

  it("emits the TileFrame field shape", () => {
    const { createCanvas } = makeCanvasFactory([]);
    const frames: TileFrameOut[] = [];
    const source = new FrameSource({
      listTiles: () => [{ tile_id: "id-1", video: fakeVideo(640, 360) }],
      onFrame: (frame) => frames.push(frame),
      createCanvas,
    });
    source.start();
    vi.advanceTimersByTime(150);
    source.stop();
    expect(frames.length).toBeGreaterThan(0);
    expect(Object.keys(frames[0] as object).sort()).toEqual(
      ["bitmap", "frame_h", "frame_w", "tile_id", "ts_ms"].sort(),
    );
  });
});

describe("tile cap", () => {
  it("captures at most 6 tiles, first 6 by snapshot order", () => {
    const { createCanvas } = makeCanvasFactory([]);
    const seen = new Set<string>();
    const source = new FrameSource({
      listTiles: sevenTiles,
      onFrame: (frame) => seen.add(frame.tile_id),
      createCanvas,
    });
    source.start();
    vi.advanceTimersByTime(150);
    source.stop();
    expect([...seen].sort()).toEqual(
      ["id-1", "id-2", "id-3", "id-4", "id-5", "id-6"].sort(),
    );
  });
});

describe("missing video", () => {
  it("emits zero frames and throws nothing when tiles have no video", () => {
    const { createCanvas } = makeCanvasFactory([]);
    const frames: TileFrameOut[] = [];
    const source = new FrameSource({
      listTiles: () => [
        { tile_id: "id-1", video: null },
        { tile_id: "id-2", video: fakeVideo(0, 0) },
      ],
      onFrame: (frame) => frames.push(frame),
      createCanvas,
    });
    source.start();
    vi.advanceTimersByTime(500);
    source.stop();
    expect(frames).toEqual([]);
    expect(createCanvas).not.toHaveBeenCalled();
  });
});

describe("transfer semantics", () => {
  it("reuses one canvas per tile and transfers (not copies) each bitmap", () => {
    const { createCanvas, created } = makeCanvasFactory([]);
    const frames: TileFrameOut[] = [];
    const source = new FrameSource({
      listTiles: () => [
        { tile_id: "id-1", video: fakeVideo(640, 360) },
        { tile_id: "id-2", video: fakeVideo(320, 180) },
      ],
      onFrame: (frame) => frames.push(frame),
      createCanvas,
    });
    source.start();
    vi.advanceTimersByTime(1000);
    source.stop();
    expect(frames.length).toBeGreaterThan(4);
    expect(createCanvas).toHaveBeenCalledTimes(2);
    expect(created).toHaveLength(2);
    for (const frame of frames) {
      expect((frame.bitmap as unknown as FakeBitmap).transferred).toBe(true);
    }
  });

  it("stop() halts all frames", () => {
    const { createCanvas } = makeCanvasFactory([]);
    const frames: TileFrameOut[] = [];
    const source = new FrameSource({
      listTiles: () => [{ tile_id: "id-1", video: fakeVideo(640, 360) }],
      onFrame: (frame) => frames.push(frame),
      createCanvas,
    });
    source.start();
    vi.advanceTimersByTime(300);
    source.stop();
    const count = frames.length;
    expect(count).toBeGreaterThan(0);
    vi.advanceTimersByTime(1000);
    expect(frames).toHaveLength(count);
  });
});
