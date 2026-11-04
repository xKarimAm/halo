// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock, Overlay, notesHref } from "./overlay";
import { bindExpand, bindHideKey, mountControls, mountPopover } from "./index";
import { OVERLAY_CSS } from "./tokens";

// Badge menu and notes-ready toast (issue #73), on a real DOM.
type Listener = (msg: unknown) => void;
function setup(_clipboard?: { writeText(t: string): unknown }) {
  const listeners: Listener[] = [];
  const posted: unknown[] = [];
  const overlay = new Overlay(new FakeClock());
  const port = {
    onMessage: { addListener: (fn: Listener) => { listeners.push(fn); } },
    postMessage: (msg: unknown) => { posted.push(msg); },
  };
  const refresh = mountControls(document, overlay, port);
  // What boot() does on the same Port: apply first, then the controls refresh.
  const deliver = (envelope: { id: string; type: string; data: Record<string, unknown> }) => {
    overlay.applyEnvelope(envelope);
    for (const fn of listeners) fn({ type: "backend.envelope", envelope });
  };
  return { overlay, deliver, refresh, posted };
}
const $ = <T extends Element>(sel: string) => document.querySelector(sel) as T;
const byText = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement;
const notesReady = (id: string) => ({
  id, type: "notes.ready",
  data: { meeting_id: "22222222-2222-4222-8222-222222222222", url: "/notes/22222222-2222-4222-8222-222222222222", degraded: false, people: [] },
});

beforeEach(() => { document.body.replaceChildren(); });

describe("badge", () => {
  it("is visible from mount and follows the hidden state", () => {
    const { overlay, refresh } = setup({ writeText: () => {} });
    expect($(".halo-badge").textContent).toBe("Halo");
    overlay.hidden = true;
    refresh();
    expect($(".halo-badge").textContent).toBe("Halo · hidden");
  });
});

describe("notes-ready toast", () => {
  it("is hidden until notes.ready, then links to the notes page in a new tab", () => {
    const { deliver } = setup({ writeText: () => {} });
    const toast = $<HTMLElement>(".halo-toast");
    expect(toast.hidden).toBe(true);
    deliver(notesReady("e1"));
    expect(toast.hidden).toBe(false);
    const a = $<HTMLAnchorElement>(".halo-toast a");
    expect(a.getAttribute("href")).toBe("http://127.0.0.1:8765/notes/22222222-2222-4222-8222-222222222222");
    expect(a.target).toBe("_blank");
    expect(a.rel).toContain("noopener");
  });

  it("dismisses and stays dismissed on other messages", () => {
    const { overlay, deliver } = setup({ writeText: () => {} });
    deliver(notesReady("e1"));
    $<HTMLButtonElement>(".halo-dismiss").click();
    expect($<HTMLElement>(".halo-toast").hidden).toBe(true);
    expect(overlay.notesToast).toBeNull();
    deliver({ id: "e2", type: "system.status", data: {} });
    expect($<HTMLElement>(".halo-toast").hidden).toBe(true);
  });

  it("only links http(s) urls", () => {
    expect(notesHref("/notes/x")).toBe("http://127.0.0.1:8765/notes/x");
    expect(notesHref("javascript:alert(1)")).toBeNull();
    expect(notesHref(undefined)).toBeNull();
  });
});

// Karim 2026-11-02: one Halo menu. The badge opens the language picker and
// the legend; the consent notice moved to the toolbar popup.
describe("Halo menu", () => {
  it("the badge opens and closes a menu holding the language and the legend; no consent, no ?", () => {
    setup({ writeText: () => {} });
    const badge = $<HTMLButtonElement>("button.halo-badge");
    const menu = $<HTMLElement>(".halo-menu");
    expect(menu.hidden).toBe(true);
    badge.click();
    expect(menu.hidden).toBe(false);
    expect(badge.getAttribute("aria-expanded")).toBe("true");
    expect(menu.querySelector(".halo-lang")).not.toBeNull();
    expect(menu.textContent).toContain("Urgent");
    badge.click();
    expect(menu.hidden).toBe(true);
    badge.click();
    (menu.querySelector(".halo-lang") as HTMLElement).click(); // inside: stays open
    expect(menu.hidden).toBe(false);
    document.body.click(); // outside closes it
    expect(menu.hidden).toBe(true);
    expect(badge.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.textContent).not.toMatch(/consent/i);
    expect(byText("?")).toBeUndefined();
  });
});

// The +N chip is a button: a click expands that tile's stack.
describe("expand on click", () => {
  it("clicking +N re-renders the tile with every point", () => {
    const overlay = new Overlay(new FakeClock());
    overlay.applyTiles({ tiles: [{ tile_id: "tile-1", name: "Layla", is_self: false, rect: [0, 0, 400, 225], video_w: 640, video_h: 360, fit: "cover", captions_rect: null }] });
    for (let i = 0; i < 4; i += 1) {
      overlay.applyPointsUpsert({
        point_id: `pt-${i}`, tile_id: "tile-1", speaker_name: "Layla", kind: "point", text: `p${i}`, lang: "en",
        quote: "q", turn_ids: ["t"], rank: 1, attribution: "provisional", is_action: false, engine: "spark-open",
      } as never);
    }
    const root = document.createElement("div");
    document.body.append(root);
    const rerender = () => overlay.render(document as never, root as never, 0);
    rerender();
    bindExpand(root, overlay, rerender);
    root.querySelector<HTMLElement>('[data-expand-tile="tile-1"]')!.click();
    expect(root.querySelectorAll("[data-point-id]").length).toBe(4);
  });
});

// Original-quote popover (DECISIONS 1: "the original quote is one click away").
function withPoint(over: Record<string, unknown> = {}) {
  const overlay = new Overlay(new FakeClock());
  overlay.applyTiles({ tiles: [{ tile_id: "tile-1", name: "Layla", is_self: false, rect: [0, 0, 400, 225], video_w: 640, video_h: 360, fit: "cover", captions_rect: null }] });
  overlay.applyPointsUpsert({
    point_id: "pt-1", tile_id: "tile-1", speaker_name: "Layla", kind: "question",
    text: "Will the Arabic listing be ready?", lang: "en", quote: "هل ستكون القائمة العربية جاهزة؟",
    turn_ids: ["t-1"], rank: 1, attribution: "provisional", is_action: false, engine: "spark-open", ...over,
  } as never, "env-1");
  const root = document.createElement("div");
  document.body.append(root);
  overlay.render(document as never, root as never, 0);
  const sync = mountPopover(document, overlay, root);
  const chip = root.querySelector<HTMLButtonElement>('[data-point-id="pt-1"]')!;
  return { overlay, root, chip, sync };
}

describe("original-quote popover", () => {
  it("a bubble click shows kind, speaker, text and the original quote in its own direction", () => {
    const { chip } = withPoint();
    chip.click();
    const pop = $<HTMLElement>(".halo-popover");
    expect(pop.hidden).toBe(false);
    expect(pop.textContent).toContain("Question");
    expect(pop.textContent).toContain("Layla");
    expect(pop.textContent).toContain("Will the Arabic listing be ready?");
    const quote = $<HTMLElement>(".halo-popover blockquote");
    expect(quote.textContent).toBe("هل ستكون القائمة العربية جاهزة؟");
    expect(quote.dir).toBe("rtl");
    expect(quote.lang).toBe("ar");
  });

  it("an urgent point shows the plain word Urgent", () => {
    const { chip } = withPoint({ urgency: "urgent" });
    chip.click();
    expect($(".halo-popover").textContent).toContain("Urgent");
  });

  it("Esc closes it and focus returns to the bubble", () => {
    const { chip } = withPoint();
    chip.focus();
    chip.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect($<HTMLElement>(".halo-popover").hidden).toBe(true);
    expect(document.activeElement).toBe(chip);
  });

  it("a click outside closes it; a second click on the same bubble toggles it shut", () => {
    const { chip } = withPoint();
    chip.click();
    document.body.click();
    expect($<HTMLElement>(".halo-popover").hidden).toBe(true);
    chip.click();
    chip.click();
    expect($<HTMLElement>(".halo-popover").hidden).toBe(true);
  });
});

// Alt+H hides the bubbles (PLAN case 6); the badge reads "Halo · hidden".
describe("Alt+H on the Meet page", () => {
  const press = (init: KeyboardEventInit) => {
    const ev = new KeyboardEvent("keydown", { key: "h", bubbles: true, cancelable: true, ...init });
    document.dispatchEvent(ev);
    return ev;
  };

  it("toggles hidden, refreshes, and keeps the key from Meet", () => {
    const overlay = new Overlay(new FakeClock());
    let changes = 0;
    bindHideKey(document, overlay, () => { changes += 1; });
    const ev = press({ altKey: true });
    expect(overlay.hidden).toBe(true);
    expect(changes).toBe(1);
    expect(ev.defaultPrevented).toBe(true);
    press({ altKey: true });
    expect(overlay.hidden).toBe(false);
  });

  it("passes Ctrl+Alt+H and plain h through untouched", () => {
    const overlay = new Overlay(new FakeClock());
    let changes = 0;
    bindHideKey(document, overlay, () => { changes += 1; });
    expect(press({ altKey: true, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press({}).defaultPrevented).toBe(false);
    expect(overlay.hidden).toBe(false);
    expect(changes).toBe(0);
  });
});

// Points language from the Meet page (PLAN: badge menu -> Port set_viewer_lang;
// the hub re-sends meeting.context). Saved into the popup's stored context so
// the next Start keeps the choice.
describe("points language picker", () => {
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  function storeWith(context: unknown) {
    const data: Record<string, unknown> = { "halo.context": context };
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: { local: {
        get: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, data[k]])),
        set: async (items: Record<string, unknown>) => { Object.assign(data, items); },
      } },
    };
    return data;
  }
  afterEach(() => { delete (globalThis as unknown as { chrome?: unknown }).chrome; });

  it("starts from the saved context language", async () => {
    storeWith({ subject: "Launch", agenda: [], roles: [], viewer_lang: "ar" });
    setup({ writeText: () => {} });
    await flush();
    expect($<HTMLSelectElement>(".halo-lang").value).toBe("ar");
  });

  it("a change tells the hub and saves the language into the stored context", async () => {
    const data = storeWith({ subject: "Launch", agenda: ["a"], roles: [], viewer_lang: "en" });
    const { posted } = setup({ writeText: () => {} });
    await flush();
    const select = $<HTMLSelectElement>(".halo-lang");
    select.value = "ar";
    select.dispatchEvent(new Event("change"));
    await flush();
    expect(posted).toEqual([{ type: "set_viewer_lang", viewer_lang: "ar" }]);
    expect(data["halo.context"]).toEqual({ subject: "Launch", agenda: ["a"], roles: [], viewer_lang: "ar" });
  });

  it("defaults to English with no saved context and still tells the hub", async () => {
    storeWith(undefined);
    const { posted } = setup({ writeText: () => {} });
    await flush();
    const select = $<HTMLSelectElement>(".halo-lang");
    expect(select.value).toBe("en");
    select.value = "ar";
    select.dispatchEvent(new Event("change"));
    expect(posted).toEqual([{ type: "set_viewer_lang", viewer_lang: "ar" }]);
  });
});

// Review fixes (code review on the overlay controls PR).
describe("popover follows its bubble", () => {
  it("opening moves focus into the card", () => {
    const { chip } = withPoint();
    chip.click();
    expect(document.activeElement).toBe($(".halo-popover"));
  });

  it("a click outside closes it without pulling focus back to the bubble", () => {
    const { chip } = withPoint();
    const chat = document.createElement("input");
    document.body.append(chat);
    chip.click();
    chat.focus();
    chat.click();
    expect($<HTMLElement>(".halo-popover").hidden).toBe(true);
    expect(document.activeElement).toBe(chat);
  });

  it("closes when Alt+H hides the bubbles or the point expires", () => {
    const { overlay, chip, sync } = withPoint();
    chip.click();
    overlay.hidden = true;
    sync();
    expect($<HTMLElement>(".halo-popover").hidden).toBe(true);
    overlay.hidden = false;
    chip.click();
    overlay.points.delete("pt-1");
    sync();
    expect($<HTMLElement>(".halo-popover").hidden).toBe(true);
  });

  it("a correction to the open point updates the card in place", () => {
    const { overlay, chip, sync } = withPoint();
    chip.click();
    overlay.applyPointsUpsert({
      point_id: "pt-1", tile_id: "tile-1", speaker_name: "Omar", kind: "decision",
      text: "Launch on the 15th.", lang: "en", quote: "we launch on the 15th",
      turn_ids: ["t-1"], rank: 1, attribution: "locked", is_action: false, engine: "spark-open",
    } as never, "env-2");
    sync();
    const pop = $<HTMLElement>(".halo-popover");
    expect(pop.hidden).toBe(false);
    expect(pop.textContent).toContain("Decision · Omar");
    expect(pop.textContent).toContain("we launch on the 15th");
  });
});

describe("Alt+H is bare Alt+H only", () => {
  it("Alt+Shift+H and Alt+Meta+H pass through; a held key re-renders once", () => {
    const overlay = new Overlay(new FakeClock());
    let changes = 0;
    bindHideKey(document, overlay, () => { changes += 1; });
    const press = (init: KeyboardEventInit) => {
      const ev = new KeyboardEvent("keydown", { key: "h", bubbles: true, cancelable: true, ...init });
      document.dispatchEvent(ev);
      return ev;
    };
    expect(press({ altKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(press({ altKey: true, metaKey: true }).defaultPrevented).toBe(false);
    expect(overlay.hidden).toBe(false);
    press({ altKey: true });
    press({ altKey: true, repeat: true });
    press({ altKey: true, repeat: true });
    expect(overlay.hidden).toBe(true);
    expect(changes).toBe(1);
  });
});

describe("archive and legend (Karim 2026-11-01)", () => {
  it("Archive in the card removes the point from the bubbles and re-renders", () => {
    const overlay = new Overlay(new FakeClock());
    overlay.applyTiles({ tiles: [{ tile_id: "tile-1", name: "Layla", is_self: false, rect: [0, 0, 400, 225], video_w: 640, video_h: 360, fit: "cover", captions_rect: null }] });
    overlay.applyPointsUpsert({
      point_id: "pt-9", tile_id: "tile-1", speaker_name: "Layla", kind: "point", text: "Fix the mic", lang: "en",
      quote: "fix the mic", turn_ids: ["t-1"], rank: 1, attribution: "provisional", is_action: true,
      engine: "spark-open", urgency: "urgent",
    } as never, "env-9");
    const root = document.createElement("div");
    document.body.append(root);
    let renders = 0;
    const render = () => { renders += 1; overlay.render(document as never, root as never, 0); };
    render();
    mountPopover(document, overlay, root, render);
    root.querySelector<HTMLButtonElement>('[data-point-id="pt-9"]')!.click();
    byText("Archive").click();
    expect(overlay.visiblePoints("tile-1")).toEqual([]);
    expect($<HTMLElement>(".halo-popover").hidden).toBe(true);
    expect(renders).toBe(2);
  });

  it("the Halo badge shows a legend of urgency colours and kind glyphs", () => {
    // The real stylesheet: a display rule once beat [hidden] and the
    // legend covered the bubbles (joined run 2026-11-01).
    const style = document.createElement("style");
    style.textContent = OVERLAY_CSS;
    document.head.append(style);
    setup({ writeText: () => {} });
    const menu = $<HTMLElement>(".halo-menu");
    const legend = $<HTMLElement>(".halo-legend");
    expect(getComputedStyle(menu).display).toBe("none");
    $<HTMLButtonElement>("button.halo-badge").click();
    expect(getComputedStyle(menu).display).not.toBe("none");
    expect(getComputedStyle(legend).display).toBe("grid");
    for (const word of ["Urgent", "Medium", "Later", "Question", "Decision", "Pushback"]) {
      expect(legend.textContent).toContain(word);
    }
  });
});

describe("meeting coach panel", () => {
  const tips = (id: string, list: string[], lang = "en") => ({ id, type: "coach.tips", data: { tips: list, lang } });

  it("is hidden until coach.tips, then shows the newest tips only", () => {
    const { deliver } = setup();
    const panel = $<HTMLElement>(".halo-coach");
    expect(panel.hidden).toBe(true);
    deliver(tips("c1", ["Ask Omar for a date.", "Nobody owns the checklist."]));
    expect(panel.hidden).toBe(false);
    expect([...panel.querySelectorAll("li")].map((li) => li.textContent))
      .toEqual(["Ask Omar for a date.", "Nobody owns the checklist."]);
    deliver(tips("c2", ["Layla has not spoken yet."]));
    expect([...panel.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["Layla has not spoken yet."]);
  });

  it("shows an alert above the tips, and an alert alone still opens the panel", () => {
    const { deliver } = setup();
    const panel = $<HTMLElement>(".halo-coach");
    const alert = $<HTMLElement>(".halo-coach-alert");
    deliver(tips("c1", ["Ask Omar for a date."]));
    expect(alert.hidden).toBe(true);
    deliver({ id: "c2", type: "coach.tips", data: { tips: [], alert: "De-escalate now.", lang: "en" } });
    expect(panel.hidden).toBe(false);
    expect(alert.hidden).toBe(false);
    expect(alert.textContent).toBe("De-escalate now.");
    deliver({ id: "c3", type: "coach.tips", data: { tips: [], lang: "en" } });
    expect(panel.hidden).toBe(true);
  });

  it("dismisses until the next tips, hides with Alt+H, and sets Arabic direction", () => {
    const { overlay, deliver, refresh } = setup();
    deliver(tips("c1", ["One."]));
    $<HTMLButtonElement>(".halo-coach .halo-dismiss").click();
    const panel = $<HTMLElement>(".halo-coach");
    expect(panel.hidden).toBe(true);
    deliver(tips("c2", ["اسأل عمر عن الموعد."], "ar"));
    expect(panel.hidden).toBe(false);
    expect(panel.getAttribute("dir")).toBe("rtl");
    overlay.hidden = true;
    refresh();
    expect(panel.hidden).toBe(true);
  });
});

describe("show on screen", () => {
  it("lists four switches and unticking Coach hides the coach card", () => {
    const { overlay, deliver } = setup({ writeText: () => {} });
    deliver({ id: "c1", type: "coach.tips", data: { tips: ["Ask Sam for a date."], lang: "en" } });
    expect($<HTMLElement>(".halo-coach").hidden).toBe(false);
    const boxes = [...document.querySelectorAll<HTMLInputElement>(".halo-show input")];
    expect(boxes.map((b) => b.name)).toEqual(["names", "points", "coach", "facts"]);
    expect(boxes.every((b) => b.checked)).toBe(true);
    boxes[2].click();
    expect(overlay.show.coach).toBe(false);
    expect($<HTMLElement>(".halo-coach").hidden).toBe(true);
  });
});
