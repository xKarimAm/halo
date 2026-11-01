// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONSENT_NOTICE, FakeClock, Overlay, notesHref } from "./overlay";
import { bindHideKey, mountControls, mountPopover } from "./index";

// Badge, consent dialog and notes-ready toast (issue #73), on a real DOM.
type Listener = (msg: unknown) => void;
function setup(clipboard: { writeText(t: string): unknown }) {
  const listeners: Listener[] = [];
  const posted: unknown[] = [];
  const overlay = new Overlay(new FakeClock());
  const port = {
    onMessage: { addListener: (fn: Listener) => { listeners.push(fn); } },
    postMessage: (msg: unknown) => { posted.push(msg); },
  };
  const refresh = mountControls(document, overlay, port, clipboard);
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

describe("consent dialog", () => {
  it("opens with the bilingual notice, RTL-safe", () => {
    setup({ writeText: () => {} });
    byText("Consent notice").click();
    expect($<HTMLDialogElement>(".halo-dialog").open).toBe(true);
    const notice = $<HTMLTextAreaElement>(".halo-notice");
    expect(notice.value).toBe(CONSENT_NOTICE);
    expect(notice.dir).toBe("auto");
  });

  it("Copy notice puts the (edited) notice on the clipboard and confirms", async () => {
    const written: string[] = [];
    setup({ writeText: async (t: string) => { written.push(t); } });
    byText("Consent notice").click();
    $<HTMLTextAreaElement>(".halo-notice").value = "edited notice";
    byText("Copy notice").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(written).toEqual(["edited notice"]);
    expect($(".halo-copy-status").textContent).toBe("Copied. Paste it into Meet chat.");
  });

  it("says so when the clipboard refuses", async () => {
    setup({ writeText: async () => { throw new Error("denied"); } });
    byText("Consent notice").click();
    byText("Copy notice").click();
    await new Promise((r) => setTimeout(r, 0));
    expect($(".halo-copy-status").textContent).toBe("Copy failed. Select the text and copy it.");
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
  mountPopover(document, overlay, root);
  const chip = root.querySelector<HTMLButtonElement>('[data-point-id="pt-1"]')!;
  return { overlay, root, chip };
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
