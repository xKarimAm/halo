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
  it("urgent shows plain-text Urgent in the popover, no mark on the bubble", () => {
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
