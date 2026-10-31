// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Tile } from "../../../contracts/ext/meeting-adapter";
import { MeetDomAdapter } from "./meet_adapter";

function stubRect(el: Element, rect: { x: number; y: number; w: number; h: number }): void {
  el.getBoundingClientRect = () =>
    ({
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.w,
      bottom: rect.y + rect.h,
      toJSON: () => {},
    }) as DOMRect;
}

function stubVideo(
  video: HTMLVideoElement,
  dims: { w: number; h: number },
  fit: "cover" | "contain",
): void {
  Object.defineProperty(video, "videoWidth", { value: dims.w, configurable: true });
  Object.defineProperty(video, "videoHeight", { value: dims.h, configurable: true });
  video.style.objectFit = fit;
}

/**
 * Fixture mirroring the day-0 probe DOM (issue #47): names in
 * `span.notranslate`, self tile carrying the `visual_effects` icon,
 * speaking signalled by class `sxlEM` on the `[jsname="QgSmzd"]`
 * descendant, real Meet video `object-fit: contain`.
 */
const SPEAK_JSNAME = "QgSmzd";
const SPEAK_CLASS = "sxlEM";

function buildRoom(): HTMLElement {
  const room = document.createElement("div");
  room.id = "room";
  room.innerHTML = [
    '<div class="t" data-participant-id="id-1" data-requested-participant-id="req-1" data-tile-media-id="m1">',
    "<video></video>",
    '<span class="notranslate">Karim Amer</span>',
    '<button aria-label="Pin Karim Amer"><span>keep_outline</span></button>',
    `<div jsname="${SPEAK_JSNAME}" class="level"></div>`,
    "</div>",
    '<div class="t" data-participant-id="id-2" data-requested-participant-id="req-2" data-tile-media-id="m2">',
    "<video></video>",
    '<span class="notranslate">ليلى حسن</span>',
    '<button aria-label="Backgrounds and effects"><i>visual_effects</i></button>',
    `<div jsname="${SPEAK_JSNAME}"></div>`,
    "</div>",
    '<div class="t" data-participant-id="id-3">',
    '<span class="notranslate">Sam Lee</span>',
    `<div jsname="${SPEAK_JSNAME}"></div>`,
    "</div>",
    '<div role="listitem" data-participant-id="id-9"><span>Panel Row</span></div>',
    '<div data-participant-id="id-1" data-tile-media-id="fx"></div>',
  ].join("");
  document.body.appendChild(room);
  const tiles = room.querySelectorAll(".t");
  stubRect(tiles[0] as Element, { x: 8, y: 8, w: 400, h: 225 });
  stubRect(tiles[1] as Element, { x: 416, y: 8, w: 400, h: 225 });
  stubRect(tiles[2] as Element, { x: 8, y: 241, w: 400, h: 225 });
  stubVideo(room.querySelectorAll("video")[0] as HTMLVideoElement, { w: 1280, h: 720 }, "contain");
  stubVideo(room.querySelectorAll("video")[1] as HTMLVideoElement, { w: 640, h: 360 }, "contain");
  return room;
}

/** Toggle the real speaking signal on a tile. */
function setSpeaking(tileId: string, on: boolean): void {
  const node = document.querySelector(
    `[data-participant-id="${tileId}"] [jsname="${SPEAK_JSNAME}"]`,
  ) as HTMLElement;
  node.classList.toggle(SPEAK_CLASS, on);
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  document.body.textContent = "";
});

afterEach(() => {
  document.body.textContent = "";
  vi.useRealTimers();
});

describe("tiles()", () => {
  it("reads every fixture tile with stable ids, names, rects and self flag", () => {
    buildRoom();
    const adapter = new MeetDomAdapter({ root: document.body, pollIntervalMs: 0 });
    const tiles = adapter.tiles();
    adapter.dispose();
    expect(tiles.map((tile) => tile.tile_id)).toEqual(["id-1", "id-2", "id-3"]);
    expect(tiles.map((tile) => tile.name)).toEqual(["Karim Amer", "ليلى حسن", "Sam Lee"]);
    expect(tiles.map((tile) => tile.is_self)).toEqual([false, true, false]);
    expect(tiles[0]?.rect).toEqual([8, 8, 400, 225]);
  });

  it("excludes the panel row and the duplicate fx node for the same participant", () => {
    buildRoom();
    const adapter = new MeetDomAdapter({ root: document.body, pollIntervalMs: 0 });
    const tiles = adapter.tiles();
    adapter.dispose();
    expect(tiles).toHaveLength(3);
    expect(tiles.map((tile) => tile.tile_id)).not.toContain("id-9");
  });

  it("emits the exact tiles.snapshot tile shape", () => {
    buildRoom();
    const adapter = new MeetDomAdapter({ root: document.body, pollIntervalMs: 0 });
    const tiles = adapter.tiles();
    adapter.dispose();
    const first = tiles[0] as Tile;
    expect(Object.keys(first).sort()).toEqual(
      ["captions_rect", "fit", "is_self", "name", "rect", "tile_id", "video_h", "video_w"].sort(),
    );
    expect(first).toEqual({
      tile_id: "id-1",
      name: "Karim Amer",
      is_self: false,
      rect: [8, 8, 400, 225],
      video_w: 1280,
      video_h: 720,
      fit: "contain",
      captions_rect: null,
    });
  });

  it("snapshots canvas-only tiles with zeroed video fields and no error", () => {
    buildRoom();
    const adapter = new MeetDomAdapter({ root: document.body, pollIntervalMs: 0 });
    const tiles = adapter.tiles();
    adapter.dispose();
    const canvasOnly = tiles.find((tile) => tile.tile_id === "id-3");
    expect(canvasOnly).toMatchObject({ video_w: 0, video_h: 0, fit: "cover" });
  });

  it("falls back to the first span outside buttons when notranslate is absent", () => {
    buildRoom();
    const tile = document.querySelector('[data-participant-id="id-3"]') as HTMLElement;
    (tile.querySelector("span") as HTMLElement).removeAttribute("class");
    const adapter = new MeetDomAdapter({ root: document.body, pollIntervalMs: 0 });
    const tiles = adapter.tiles();
    adapter.dispose();
    expect(tiles.find((t) => t.tile_id === "id-3")?.name).toBe("Sam Lee");
  });

  it("reports a screen-share tile as a tile", () => {
    const room = buildRoom();
    const share = document.createElement("div");
    share.className = "t";
    share.setAttribute("data-participant-id", "id-share");
    share.innerHTML = "<span>Karim Amer's screen</span>";
    room.appendChild(share);
    const adapter = new MeetDomAdapter({ root: document.body, pollIntervalMs: 0 });
    const tiles = adapter.tiles();
    adapter.dispose();
    expect(tiles.map((tile) => tile.tile_id)).toContain("id-share");
  });
});

describe("captions_rect", () => {
  it("is set when the captions band is present and null when absent", () => {
    const room = buildRoom();
    const band = document.createElement("div");
    band.setAttribute("role", "region");
    band.setAttribute("aria-label", "Captions");
    band.textContent = "Karim: hello";
    document.body.appendChild(band);
    stubRect(band, { x: 8, y: 400, w: 800, h: 66 });
    const adapter = new MeetDomAdapter({ root: document.body, pollIntervalMs: 0 });
    expect(adapter.tiles()[0]?.captions_rect).toEqual([8, 400, 800, 66]);
    band.remove();
    expect(adapter.tiles()[0]?.captions_rect).toBeNull();
    adapter.dispose();
    room.remove();
  });

  it("falls back to a text-bearing region when the label is localized", () => {
    buildRoom();
    const band = document.createElement("div");
    band.setAttribute("role", "region");
    band.setAttribute("aria-label", "تسميات توضيحية");
    band.textContent = "Karim: مرحبا";
    document.body.appendChild(band);
    stubRect(band, { x: 8, y: 400, w: 800, h: 66 });
    const adapter = new MeetDomAdapter({ root: document.body, pollIntervalMs: 0 });
    expect(adapter.tiles()[0]?.captions_rect).toEqual([8, 400, 800, 66]);
    adapter.dispose();
  });
});

describe("join/leave", () => {
  it("fires onJoin/onLeave once each and the next snapshot reflects it", async () => {
    const room = buildRoom();
    const adapter = new MeetDomAdapter({ root: document.body, pollIntervalMs: 0 });
    const joined: Tile[] = [];
    const left: Tile[] = [];
    const snapshots: Tile[][] = [];
    const offJoin = adapter.onJoin((tile) => joined.push(tile));
    const offLeave = adapter.onLeave((tile) => left.push(tile));
    const offTiles = adapter.onTiles((tiles) => snapshots.push(tiles));

    const extra = document.createElement("div");
    extra.className = "t";
    extra.setAttribute("data-participant-id", "id-4");
    extra.innerHTML = "<span>Dana</span>";
    room.appendChild(extra);
    await flush();
    expect(joined.map((tile) => tile.tile_id)).toEqual(["id-4"]);
    expect(adapter.tiles().map((tile) => tile.tile_id)).toContain("id-4");

    room.querySelector('[data-participant-id="id-3"]')?.remove();
    await flush();
    expect(left.map((tile) => tile.tile_id)).toEqual(["id-3"]);
    expect(adapter.tiles().map((tile) => tile.tile_id).sort()).toEqual(
      ["id-1", "id-2", "id-4"].sort(),
    );
    expect(snapshots.length).toBeGreaterThan(0);

    offJoin();
    offLeave();
    offTiles();
    adapter.dispose();
  });
});

describe("speaking", () => {
  it("emits speaker.active with the right tile and monotonic ts", async () => {
    buildRoom();
    let now = 1760000001000;
    const adapter = new MeetDomAdapter({
      root: document.body,
      pollIntervalMs: 0,
      now: () => now,
    });
    const events: { tile_id: string; speaking: boolean; ts_ms: number }[] = [];
    const off = adapter.onSpeaking((event) => events.push({ ...event }));
    setSpeaking("id-1", true);
    await flush();
    now += 40;
    setSpeaking("id-1", false);
    await flush();
    expect(events).toEqual([{ tile_id: "id-1", speaking: true, ts_ms: 1760000001000 }]);
    await new Promise((resolve) => setTimeout(resolve, 350)); // ~300 ms hold elapses
    off();
    adapter.dispose();
    expect(events).toEqual([
      { tile_id: "id-1", speaking: true, ts_ms: 1760000001000 },
      { tile_id: "id-1", speaking: false, ts_ms: 1760000001040 },
    ]);
  });

  it("holds speaking:true for ~300 ms so brief drops do not flicker", async () => {
    buildRoom();
    const adapter = new MeetDomAdapter({ root: document.body, pollIntervalMs: 0 });
    const events: { tile_id: string; speaking: boolean }[] = [];
    const off = adapter.onSpeaking((event) => events.push({ tile_id: event.tile_id, speaking: event.speaking }));
    setSpeaking("id-2", true);
    await flush();
    setSpeaking("id-2", false);
    await flush();
    setSpeaking("id-2", true); // resumes inside the hold: no false may fire
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 400));
    off();
    adapter.dispose();
    expect(events).toEqual([{ tile_id: "id-2", speaking: true }]);
  });

  it("ignores level-class churn on the same node", async () => {
    buildRoom();
    const adapter = new MeetDomAdapter({ root: document.body, pollIntervalMs: 0 });
    const events: unknown[] = [];
    const off = adapter.onSpeaking((event) => events.push(event));
    const node = document.querySelector(
      `[data-participant-id="id-1"] [jsname="${SPEAK_JSNAME}"]`,
    ) as HTMLElement;
    node.classList.add("HX2H7");
    await flush();
    node.classList.remove("HX2H7");
    node.classList.add("gjg47c");
    await flush();
    off();
    adapter.dispose();
    expect(events).toEqual([]);
  });

  it("matches the golden speaker.active field shape", async () => {
    buildRoom();
    const adapter = new MeetDomAdapter({ root: document.body, pollIntervalMs: 0 });
    const events: { tile_id: string; speaking: boolean; ts_ms: number }[] = [];
    const off = adapter.onSpeaking((event) => events.push({ ...event }));
    setSpeaking("id-1", true);
    await flush();
    off();
    adapter.dispose();
    expect(Object.keys(events[0] as object).sort()).toEqual(
      ["speaking", "tile_id", "ts_ms"].sort(),
    );
  });
});

describe("field changes", () => {
  it("emits a new snapshot within one poll when a rect changes with ids unchanged", async () => {
    buildRoom();
    const adapter = new MeetDomAdapter({ root: document.body, pollIntervalMs: 20 });
    const snapshots: Tile[][] = [];
    const off = adapter.onTiles((tiles) => snapshots.push(tiles));
    const tile = document.querySelector('[data-participant-id="id-1"]') as Element;
    stubRect(tile, { x: 100, y: 100, w: 200, h: 120 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    off();
    adapter.dispose();
    expect(snapshots.length).toBeGreaterThan(0);
    const latest = snapshots[snapshots.length - 1] as Tile[];
    expect(latest.map((t) => t.tile_id)).toEqual(["id-1", "id-2", "id-3"]);
    expect(latest[0]?.rect).toEqual([100, 100, 200, 120]);
  });

  it("emits no snapshot when a poll finds nothing changed", async () => {
    buildRoom();
    const adapter = new MeetDomAdapter({ root: document.body, pollIntervalMs: 20 });
    const snapshots: Tile[][] = [];
    const off = adapter.onTiles((tiles) => snapshots.push(tiles));
    await new Promise((resolve) => setTimeout(resolve, 100));
    off();
    adapter.dispose();
    expect(snapshots).toEqual([]);
  });

  it("rescans on window resize", async () => {
    buildRoom();
    const adapter = new MeetDomAdapter({ root: document.body, pollIntervalMs: 0 });
    const snapshots: Tile[][] = [];
    const off = adapter.onTiles((tiles) => snapshots.push(tiles));
    const tile = document.querySelector('[data-participant-id="id-2"]') as Element;
    stubRect(tile, { x: 0, y: 0, w: 320, h: 180 });
    window.dispatchEvent(new window.Event("resize"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    off();
    adapter.dispose();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.find((t) => t.tile_id === "id-2")?.rect).toEqual([0, 0, 320, 180]);
  });
});

describe("matches()", () => {
  it("handles Meet URLs only", () => {
    const adapter = new MeetDomAdapter({ root: document.body, pollIntervalMs: 0 });
    expect(adapter.matches("https://meet.google.com/abc-defg-hij")).toBe(true);
    expect(adapter.matches("https://app.zoom.us/wc/123")).toBe(false);
    expect(adapter.matches("https://teams.microsoft.com/meet")).toBe(false);
    adapter.dispose();
  });
});
