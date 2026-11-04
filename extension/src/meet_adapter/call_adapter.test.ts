// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import type { Tile } from "../../../contracts/ext/meeting-adapter";
import { CallPageAdapter } from "./call_adapter";

function video(w: number, h: number): HTMLVideoElement {
  const v = document.createElement("video");
  v.getBoundingClientRect = () => ({ x: 10, y: 20, width: w, height: h, top: 20, left: 10, right: 10 + w, bottom: 20 + h, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(v);
  return v;
}

describe("CallPageAdapter (Zoom and Teams web, Karim 2026-11-04)", () => {
  it("reports no tiles until Halo runs, so the Halo-is-off nudge and the Correlator see nothing", () => {
    document.body.innerHTML = "";
    const a = new CallPageAdapter("zoom", { pollIntervalMs: 0 });
    expect(a.tiles()).toEqual([]);
  });

  it("while running: a self tile for the mic and one call tile on the largest video", () => {
    document.body.innerHTML = "";
    video(120, 90);
    const big = video(800, 450);
    const a = new CallPageAdapter("teams", { pollIntervalMs: 0 });
    const seen: Tile[][] = [];
    a.onTiles((t) => seen.push(t));
    a.setRunning(true);
    const tiles = a.tiles();
    expect(tiles.map((t) => [t.tile_id, t.is_self])).toEqual([["call", false], ["self", true]]);
    expect(tiles[0].rect).toEqual([10, 20, 800, 450]);
    expect(a.video("call")).toBe(big);
    expect(seen.at(-1)).toEqual(tiles); // the change goes out at once
    a.setRunning(false);
    expect(seen.at(-1)).toEqual([]);
  });

  it("with no video on the page the call tile covers the window", () => {
    document.body.innerHTML = "";
    const a = new CallPageAdapter("zoom", { pollIntervalMs: 0 });
    a.setRunning(true);
    const call = a.tiles().find((t) => t.tile_id === "call")!;
    expect(call.rect).toEqual([0, 0, window.innerWidth, window.innerHeight]);
    expect(a.matches("https://app.zoom.us/wc/81234567890/join")).toBe(true);
    expect(a.matches("https://meet.google.com/abc-defg-hij")).toBe(false);
  });
});
