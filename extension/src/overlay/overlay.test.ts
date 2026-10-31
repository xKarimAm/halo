import { describe, expect, it } from "vitest";
import {
  CONSENT_NOTICE,
  FakeClock,
  Overlay,
  copyConsentNotice,
  projectFaceBox,
  type El,
  type PointUpsert,
} from "./overlay";

// Minimal fake DOM: the renderer only uses createElement/textContent/
// setAttribute/appendChild/remove/classList, exactly the Trusted-Types-safe set.
class FakeEl implements El {
  children: FakeEl[] = [];
  attrs = new Map<string, string>();
  classes = new Set<string>();
  text = "";
  parent: FakeEl | null = null;
  style = { setProperty: (k: string, v: string) => this.attrs.set(`style:${k}`, v) };
  classList = {
    add: (c: string) => this.classes.add(c),
    toggle: (c: string, on?: boolean) => (on === false ? this.classes.delete(c) : this.classes.add(c)),
    contains: (c: string) => this.classes.has(c),
  };
  set textContent(v: string) { this.text = v; this.children = []; }
  get textContent(): string { return this.text + this.children.map((c) => c.textContent).join(""); }
  setAttribute(k: string, v: string): void { this.attrs.set(k, v); }
  appendChild(c: FakeEl): FakeEl { c.parent = this; this.children.push(c); return c; }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); }
  find(pred: (e: FakeEl) => boolean): FakeEl[] {
    return [...(pred(this) ? [this] : []), ...this.children.flatMap((c) => c.find(pred))];
  }
}
const doc = { createElement: () => new FakeEl() };

// Real-DOM-shaped element: `children` is a getter-only accessor (as on a
// real Element), so assigning `el.children = []` throws in strict mode.
// Regression seam for the joined gate: render() must clear a layer by
// removing child nodes, never by assigning children.
class RealishEl implements El {
  private kids: RealishEl[] = [];
  attrs = new Map<string, string>();
  classes = new Set<string>();
  text = "";
  parent: RealishEl | null = null;
  style = { setProperty: (k: string, v: string) => this.attrs.set(`style:${k}`, v) };
  classList = {
    add: (c: string) => this.classes.add(c),
    toggle: (c: string, on?: boolean) => (on === false ? this.classes.delete(c) : this.classes.add(c)),
    contains: (c: string) => this.classes.has(c),
  };
  get children(): RealishEl[] { return this.kids; }
  set textContent(v: string) { this.text = v; this.kids.length = 0; }
  get textContent(): string { return this.text + this.kids.map((c) => c.textContent).join(""); }
  setAttribute(k: string, v: string): void { this.attrs.set(k, v); }
  appendChild(c: RealishEl): RealishEl { c.parent = this; this.kids.push(c); return c; }
  remove(): void {
    if (this.parent) {
      const i = this.parent.kids.indexOf(this);
      if (i >= 0) this.parent.kids.splice(i, 1);
    }
  }
  find(pred: (e: RealishEl) => boolean): RealishEl[] {
    return [...(pred(this) ? [this] : []), ...this.kids.flatMap((c) => c.find(pred))];
  }
}
const realishDoc = { createElement: () => new RealishEl() };

let n = 0;
function point(over: Partial<PointUpsert> = {}): PointUpsert {
  n += 1;
  return {
    point_id: `pt-${n}`, tile_id: "tile-1", speaker_name: "Layla", kind: "point",
    text: `point ${n}`, lang: "en", quote: "original quote", turn_ids: ["t-1"],
    rank: 1, attribution: "provisional", is_action: false, engine: "spark-open", ...over,
  };
}
function make(now = 0) {
  const clock = new FakeClock(now);
  const overlay = new Overlay(clock);
  overlay.applyTiles({ tiles: [{ tile_id: "tile-1", name: "Layla", is_self: false, rect: [0, 0, 400, 225], video_w: 640, video_h: 360, fit: "cover", captions_rect: null }] });
  return { overlay, clock };
}

// (1) Frame mode pins name + stack inside the tile; Face projection math
describe("layout", () => {
  it("frame mode pins inside the tile and face mode projects the box", () => {
    const { overlay } = make();
    const layout = overlay.layout("tile-1");
    expect(layout.mode).toBe("frame");
    expect(layout.namePos).toEqual({ x: 10, y: 10 });
    expect(layout.stackPos.x).toBe(10);
    const tile = { rect: [100, 50, 400, 225], video_w: 640, video_h: 360, fit: "cover" as const, is_self: false };
    const box = projectFaceBox(tile, [0.25, 0.2, 0.2, 0.4]);
    expect(box.x).toBeGreaterThan(100);
    expect(box.y).toBeGreaterThan(50);
    const flipped = projectFaceBox({ ...tile, is_self: true }, [0.25, 0.2, 0.2, 0.4]);
    expect(flipped.x).toBeGreaterThan(box.x); // mirrored self tile flips x
  });
});

// Joined-gate regression: render against a real-DOM-shaped tree (getter-
// only children) must not throw and must render every tile's chip.
describe("render on a real-DOM-shaped tree", () => {
  it("renders layers and chips for all tiles without assigning children", () => {
    const clock = new FakeClock(0);
    const overlay = new Overlay(clock);
    overlay.applyTiles({
      tiles: [
        { tile_id: "tile-1", name: "Karim", is_self: true, rect: [0, 0, 400, 225], video_w: 640, video_h: 360, fit: "cover", captions_rect: null },
        { tile_id: "tile-2", name: "Layla", is_self: false, rect: [408, 0, 400, 225], video_w: 640, video_h: 360, fit: "cover", captions_rect: null },
      ],
    });
    overlay.applyPointsUpsert(point({ tile_id: "tile-2", text: "Launch moves to Nov 12" }), "env-1");
    const root = new RealishEl();
    overlay.render(realishDoc as never, root as never);
    overlay.render(realishDoc as never, root as never); // second render clears, not throws
    const layers = root.find((e) => e.attrs.has("data-tile-id"));
    expect(layers.map((l) => l.attrs.get("data-tile-id"))).toEqual(["tile-1", "tile-2"]);
    const chips = root.find((e) => e.attrs.has("data-point-id"));
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain("Launch moves to Nov 12");
  });
});

// (2) correction in place, replaces removes; (3) user tag wins over model
describe("point lifecycle", () => {
  it("correction reuses the same element and replaces removes the old", () => {
    const { overlay } = make();
    const root = new FakeEl();
    const p = point();
    overlay.applyPointsUpsert(p, "env-1");
    overlay.render(doc as never, root as never, 0);
    const before = root.find((e) => e.attrs.get("data-point-id") === p.point_id);
    expect(before).toHaveLength(1);
    overlay.applyPointsUpsert({ ...p, text: "corrected text" }, "env-2");
    overlay.render(doc as never, root as never, 10);
    const after = root.find((e) => e.attrs.get("data-point-id") === p.point_id);
    expect(after[0]).toBe(before[0]);
    expect(after[0].textContent).toContain("corrected text");
    const newer = point({ replaces: p.point_id });
    overlay.applyPointsUpsert(newer, "env-3");
    expect(overlay.points.has(p.point_id)).toBe(false);
  });

  it("a model tag after a user tag is ignored", () => {
    const { overlay } = make();
    const p = point();
    overlay.applyPointsUpsert(p, "env-1");
    overlay.applyTagsSet({ target: "point", target_id: p.point_id, kind: "decision", source: "user" });
    overlay.applyTagsSet({ target: "point", target_id: p.point_id, kind: "point", source: "model", model: "m" });
    expect(overlay.points.get(p.point_id)?.kind).toBe("decision");
  });
});

// (4) expiry ~60 s, ageing at 72%, overflow folds to +N
describe("expiry and folding", () => {
  it("ages at 72%, expires at 60 s, folds overflow into +N", () => {
    const { overlay, clock } = make();
    const pts = [point({ rank: 1 }), point({ rank: 2 }), point({ rank: 3 }), point({ rank: 3 })];
    pts.forEach((p, i) => overlay.applyPointsUpsert(p, `env-${i}`));
    expect(overlay.visiblePoints("tile-1").map((p) => p.point_id)).toHaveLength(3);
    expect(overlay.overflowCount("tile-1")).toBe(1);
    clock.now = 44_000; // >72% of 60 s
    expect(overlay.isAged(pts[0].point_id)).toBe(true);
    clock.now = 61_000;
    expect(overlay.visiblePoints("tile-1")).toHaveLength(0);
  });
});

// Review fix: captions floor — a bubble's bottom never goes below
// captions_rect's top edge (null = no floor)
describe("captions floor", () => {
  it("folds bubbles that would cross the captions top edge", () => {
    const { overlay } = make();
    overlay.applyTiles({ tiles: [{ tile_id: "tile-1", name: "Layla", is_self: false, rect: [0, 0, 400, 225], video_w: 640, video_h: 360, fit: "cover", captions_rect: [0, 100, 400, 40] }] });
    const pts = [point({ rank: 1 }), point({ rank: 2 }), point({ rank: 3 })];
    pts.forEach((p, i) => overlay.applyPointsUpsert(p, `env-c${i}`));
    expect(overlay.layout("tile-1").floorY).toBe(100);
    expect(overlay.visiblePoints("tile-1")).toHaveLength(1); // only the first fits above y=100
    expect(overlay.overflowCount("tile-1")).toBe(2);
    expect(overlay.bubbleBottom("tile-1")).toBeLessThanOrEqual(100);
  });

  it("null captions_rect means no floor: the normal cap applies", () => {
    const { overlay } = make(); // make() uses captions_rect: null
    const pts = [point({ rank: 1 }), point({ rank: 2 }), point({ rank: 3 })];
    pts.forEach((p, i) => overlay.applyPointsUpsert(p, `env-n${i}`));
    expect(overlay.layout("tile-1").floorY).toBeNull();
    expect(overlay.visiblePoints("tile-1")).toHaveLength(3);
    expect(overlay.overflowCount("tile-1")).toBe(0);
  });
});

// (5) thinking sweep, (6) Alt+H, (9) Arabic pill attrs
describe("thinking, hide, language", () => {
  it("thinking runs from speaker pause until a point lands or 5 s pass", () => {
    const { overlay, clock } = make();
    overlay.applySpeakerActive({ tile_id: "tile-1", speaking: true, ts_ms: 0 });
    clock.now = 1000;
    overlay.applySpeakerActive({ tile_id: "tile-1", speaking: false, ts_ms: 1000 });
    expect(overlay.thinking("tile-1", false)).toBe("sweep");
    expect(overlay.thinking("tile-1", true)).toBe("dotted"); // reduced motion
    clock.now = 7000;
    expect(overlay.thinking("tile-1", false)).toBe(null);
  });

  it("Alt+H toggles layers; Ctrl+Alt+H passes through; repeat ignored", () => {
    const { overlay } = make();
    expect(overlay.handleKey({ altKey: true, ctrlKey: false, key: "h", repeat: false })).toBe(true);
    expect(overlay.hidden).toBe(true);
    expect(overlay.badgeText()).toBe("Halo · hidden");
    expect(overlay.handleKey({ altKey: true, ctrlKey: true, key: "h", repeat: false })).toBe(false);
    expect(overlay.handleKey({ altKey: true, ctrlKey: false, key: "h", repeat: true })).toBe(true);
    expect(overlay.hidden).toBe(true);
  });

  it("an Arabic point renders lang=ar dir=rtl", () => {
    const { overlay } = make();
    const root = new FakeEl();
    overlay.applyPointsUpsert(point({ lang: "ar", text: "نقطة عربية" }), "env-1");
    overlay.render(doc as never, root as never, 0);
    const chip = root.find((e) => e.attrs.has("data-point-id"))[0];
    expect(chip.attrs.get("lang")).toBe("ar");
    expect(chip.attrs.get("dir")).toBe("rtl");
  });
});

// (7) popover model; (8) consent copy touches only the clipboard
describe("popover and consent", () => {
  it("urgent shows plain-text Urgent in the popover (bubble marks are covered below)", () => {
    const { overlay } = make();
    const p = point({ urgency: "urgent", kind: "decision" });
    overlay.applyPointsUpsert(p, "env-1");
    const pop = overlay.popover(p.point_id);
    expect(pop?.urgentWord).toBe("Urgent");
    expect(pop?.quoteDir).toBe("ltr");
    const root = new FakeEl();
    overlay.render(doc as never, root as never, 0);
    const chip = root.find((e) => e.attrs.has("data-point-id"))[0];
    expect(chip.attrs.has("data-urgency-mark")).toBe(false);
  });

  it("copy notice puts the bilingual notice on the clipboard only", async () => {
    const written: string[] = [];
    const text = await copyConsentNotice({ writeText: (t: string) => { written.push(t); } });
    expect(text).toBe(CONSENT_NOTICE);
    expect(written).toEqual([CONSENT_NOTICE]);
    expect(CONSENT_NOTICE).toMatch(/record/i);
  });
});

// Urgency mark (DECISIONS: draft-2 word tabs by default, draft-1 shape seals
// via the `halo.urgencyStyle` viewer setting). Tabs carry the word in the
// bubble's language; seals carry ! (urgent), = (medium), or nothing (later).
function marksOf(root: FakeEl): FakeEl[] {
  return root.find((e) => e.classes.has("halo-utab") || e.classes.has("halo-useal"));
}

describe("urgency mark", () => {
  it("words style (default): tab words per urgency in English", () => {
    const { overlay } = make();
    const root = new FakeEl();
    const ids = ["urgent", "medium", "later"] as const;
    const words = ["URGENT", "MEDIUM", "LATER"];
    ids.forEach((urgency, i) => overlay.applyPointsUpsert(point({ urgency, rank: i + 1 }), `env-u${i}`));
    overlay.render(doc as never, root as never, 0);
    const marks = marksOf(root);
    expect(marks).toHaveLength(3);
    marks.forEach((m, i) => {
      expect(m.classes.has("halo-utab")).toBe(true);
      expect(m.classes.has(`halo-u-${ids[i]}`)).toBe(true);
      expect(m.textContent).toBe(words[i]);
    });
  });

  it("words style: Arabic bubble gets the Arabic word", () => {
    const { overlay } = make();
    const root = new FakeEl();
    overlay.applyPointsUpsert(point({ urgency: "urgent", lang: "ar", rank: 1 }), "env-a");
    overlay.applyPointsUpsert(point({ urgency: "later", lang: "en", rank: 2 }), "env-m");
    overlay.render(doc as never, root as never, 0);
    const marks = marksOf(root);
    expect(marks.map((m) => m.textContent)).toEqual(["عاجل", "LATER"]);
  });

  it("symbols style: seals with glyphs, later seal empty", () => {
    const { overlay } = make();
    overlay.setUrgencyStyle("symbols");
    const root = new FakeEl();
    (["urgent", "medium", "later"] as const).forEach((urgency, i) =>
      overlay.applyPointsUpsert(point({ urgency, rank: i + 1 }), `env-s${i}`));
    overlay.render(doc as never, root as never, 0);
    const marks = marksOf(root);
    expect(marks).toHaveLength(3);
    expect(marks.map((m) => m.textContent)).toEqual(["!", "=", ""]);
    marks.forEach((m) => expect(m.classes.has("halo-useal")).toBe(true));
    expect(marks[2].classes.has("halo-u-later")).toBe(true);
  });

  it("live switch: setUrgencyStyle swaps tabs for seals on re-render", () => {
    const { overlay } = make();
    const root = new FakeEl();
    overlay.applyPointsUpsert(point({ urgency: "medium" }), "env-1");
    overlay.render(doc as never, root as never, 0);
    expect(marksOf(root)[0].textContent).toBe("MEDIUM");
    overlay.setUrgencyStyle("symbols");
    overlay.render(doc as never, root as never, 0);
    const marks = marksOf(root);
    expect(marks).toHaveLength(1);
    expect(marks[0].classes.has("halo-useal")).toBe(true);
    expect(marks[0].textContent).toBe("=");
    overlay.setUrgencyStyle("words");
    overlay.render(doc as never, root as never, 0);
    expect(marksOf(root)[0].textContent).toBe("MEDIUM");
  });

  it("RTL: an Arabic bubble carries its mark with dir=rtl", () => {
    const { overlay } = make();
    const root = new FakeEl();
    overlay.applyPointsUpsert(point({ urgency: "urgent", lang: "ar" }), "env-1");
    overlay.render(doc as never, root as never, 0);
    const chip = root.find((e) => e.attrs.has("data-point-id"))[0];
    expect(chip.attrs.get("dir")).toBe("rtl");
    expect(marksOf(chip as unknown as FakeEl)).toHaveLength(1);
    overlay.setUrgencyStyle("symbols");
    overlay.render(doc as never, root as never, 0);
    expect(marksOf(root)[0].classes.has("halo-useal")).toBe(true);
  });

  it("points without urgency render no mark; bad styles are ignored", () => {
    const { overlay } = make();
    const root = new FakeEl();
    overlay.applyPointsUpsert(point(), "env-1");
    overlay.render(doc as never, root as never, 0);
    expect(marksOf(root)).toHaveLength(0);
    overlay.setUrgencyStyle("bogus");
    expect(overlay.urgencyStyle).toBe("words");
  });
});
