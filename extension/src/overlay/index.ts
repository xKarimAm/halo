// Meet-page boot (called by the hub content wrapper): wires Port envelopes
// and in-tab feeds into the overlay and renders into the Meet page.
import type { ToPagePortMessage } from "../../../contracts/ext/port";
import {
  Overlay, SystemClock, notesHref,
  type DocLike, type El, type UrgencyStyle,
} from "./overlay";
import { KIND_GLYPHS, OVERLAY_CSS, URGENCY_COLORS } from "./tokens";

// Viewer urgency-mark setting, shared with the setup panel (no ambient
// chrome types in this lane: structural access keeps the two lanes' globals
// from colliding).
export const URGENCY_STYLE_KEY = "halo.urgencyStyle";
interface LocalStore {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set?(items: Record<string, unknown>): Promise<void>;
}
interface ChromeLike {
  storage?: {
    local?: LocalStore;
    onChanged?: { addListener(fn: (changes: Record<string, { newValue?: unknown }>) => void): void };
  };
}
function chromeApi(): ChromeLike | undefined {
  return (globalThis as unknown as { chrome?: ChromeLike }).chrome;
}

export async function readUrgencyStyle(): Promise<UrgencyStyle> {
  try {
    const v = (await chromeApi()?.storage?.local?.get([URGENCY_STYLE_KEY]))?.[URGENCY_STYLE_KEY];
    return v === "symbols" ? "symbols" : "words"; // default: draft-2 word tabs
  } catch {
    return "words";
  }
}

/** Apply the stored style now, then re-render live on storage.onChanged. */
export function watchUrgencyStyle(
  overlay: Overlay,
  rerender: () => void,
): void {
  readUrgencyStyle().then((style) => {
    overlay.setUrgencyStyle(style);
    rerender();
  });
  try {
    chromeApi()?.storage?.onChanged?.addListener((changes) => {
      if (URGENCY_STYLE_KEY in changes) {
        overlay.setUrgencyStyle(changes[URGENCY_STYLE_KEY].newValue);
        rerender();
      }
    });
  } catch {
    // storage events unavailable (tests): the initial read still applies.
  }
}

export function boot(context: { port: PortIn }): Overlay {
  const overlay = new Overlay(new SystemClock());
  const doc = document as unknown as DocLike;
  const style = document.createElement("style");
  style.textContent = `${OVERLAY_CSS}
.halo-chip{pointer-events:auto}`;
  document.head.appendChild(style);
  const root = document.createElement("div") as unknown as El;
  // Live 2026-10-31: a static root sat under Meet's own layers (nothing
  // visible). Fixed, full-viewport, topmost; clicks pass through except chips.
  (root as unknown as HTMLElement).style.cssText =
    "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
  document.body.appendChild(root as unknown as Node);
  let syncPopover = (): void => {};
  const rerender = (): void => {
    overlay.render(doc, root as El & { children?: El[] });
    syncPopover();
  };
  context.port.onMessage.addListener((msg) => {
    const m = msg as ToPagePortMessage;
    if (m.type === "backend.envelope") {
      overlay.applyEnvelope(m.envelope as never);
      rerender();
    }
  });
  watchUrgencyStyle(overlay, rerender);
  const refresh = mountControls(document, overlay, context.port);
  syncPopover = mountPopover(document, overlay, root as unknown as Element, rerender);
  bindExpand(root as unknown as Element, overlay, rerender);
  bindHideKey(document, overlay, () => { rerender(); refresh(); });
  return overlay;
}

const KIND_LABELS: Record<string, string> = {
  point: "Point", question: "Question", decision: "Decision", pushback: "Pushback",
};

/** Original-quote popover (DECISIONS 1, OVERLAY-UX 6): a bubble click opens
 * kind, speaker, the shown text and the original quote in its own script
 * direction, below the bubble or above it near the bottom of the screen.
 * Focus moves into the card; Esc (or a second click on the bubble) closes it
 * and returns focus to the bubble, a click elsewhere just closes it. Chips are
 * re-rendered in place, so clicks are resolved on the overlay root by
 * data-point-id. Returns sync(), called after every render: it closes the
 * card when its point is gone or hidden, and refreshes a corrected point. */
export function mountPopover(doc: Document, overlay: Overlay, root: Element, onChange: () => void = () => {}): () => void {
  const pop = doc.createElement("div");
  pop.className = "halo-popover";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Original quote");
  pop.tabIndex = -1;
  pop.hidden = true;
  doc.body.append(pop);
  let openId: string | null = null;
  let opener: HTMLElement | null = null;
  const close = (returnFocus: boolean): void => {
    if (pop.hidden) return;
    pop.hidden = true;
    openId = null;
    if (returnFocus) opener?.focus();
  };
  const fill = (id: string): boolean => {
    const p = overlay.popover(id);
    if (!p) return false;
    const head = doc.createElement("p");
    head.className = "halo-pop-head";
    head.textContent = [KIND_LABELS[p.kind] ?? p.kind, p.speaker, p.urgentWord].filter(Boolean).join(" · ");
    const text = doc.createElement("p");
    text.textContent = p.text;
    text.dir = "auto";
    const quote = doc.createElement("blockquote");
    quote.textContent = p.quote;
    quote.dir = p.quoteDir;
    quote.lang = p.quoteDir === "rtl" ? "ar" : "en";
    // Handled: the point leaves the bubbles (urgent ones stay until this).
    const archive = doc.createElement("button");
    archive.type = "button";
    archive.className = "halo-btn";
    archive.textContent = "Archive";
    archive.addEventListener("click", () => {
      overlay.archive(id);
      close(false);
      onChange();
    });
    const actions = doc.createElement("div");
    actions.className = "halo-pop-actions";
    actions.append(archive);
    pop.replaceChildren(head, text, quote, actions);
    return true;
  };
  root.addEventListener("click", (ev) => {
    const chip = (ev.target as Element).closest?.("[data-point-id]") as HTMLElement | null;
    const id = chip?.getAttribute("data-point-id");
    if (!chip || !id) return;
    if (openId === id) return close(true);
    if (!fill(id)) return;
    pop.hidden = false;
    const r = chip.getBoundingClientRect();
    const h = pop.offsetHeight;
    pop.style.left = `${Math.max(12, Math.min(r.left, innerWidth - pop.offsetWidth - 12))}px`;
    pop.style.top = `${r.bottom + 6 + h > innerHeight - 12 ? Math.max(12, r.top - 6 - h) : r.bottom + 6}px`;
    openId = id;
    opener = chip;
    pop.focus();
  });
  doc.addEventListener("click", (ev) => {
    if (!(ev.target as Element).closest?.(".halo-popover, [data-point-id]")) close(false);
  });
  doc.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") close(true);
  });
  return () => {
    if (openId === null) return;
    if (overlay.hidden || !fill(openId)) close(false);
  };
}

/** A click on a tile's +N chip opens its folded points; "Less" folds them. */
export function bindExpand(root: Element, overlay: Overlay, rerender: () => void): void {
  root.addEventListener("click", (ev) => {
    const id = (ev.target as Element).closest?.("[data-expand-tile]")?.getAttribute("data-expand-tile");
    if (!id) return;
    overlay.toggleExpanded(id);
    rerender();
  });
}

/** Alt+H hides/shows the bubbles. Capture phase, so Meet never sees a key
 * Halo used. The physical key counts, so an Arabic keyboard layout works. */
export function bindHideKey(doc: Document, overlay: Overlay, onChange: () => void): void {
  doc.addEventListener("keydown", (ev) => {
    const key = ev.code === "KeyH" ? "h" : ev.key;
    const { altKey, ctrlKey, shiftKey, metaKey, repeat } = ev;
    if (!overlay.handleKey({ altKey, ctrlKey, shiftKey, metaKey, key, repeat })) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (!repeat) onChange(); // a held key toggles once
  }, true);
}

type PortIn = {
  onMessage: { addListener(fn: (msg: unknown) => void): void };
  postMessage(msg: unknown): void;
};

// The setup panel's saved meeting context; the picker keeps its viewer_lang
// in step so the next Start sends the language chosen on the Meet page.
const CONTEXT_KEY = "halo.context";
type ViewerLang = "en" | "ar";

async function readViewerLang(): Promise<ViewerLang> {
  try {
    const ctx = (await chromeApi()?.storage?.local?.get([CONTEXT_KEY]))?.[CONTEXT_KEY] as { viewer_lang?: unknown } | undefined;
    return ctx?.viewer_lang === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
}

async function saveViewerLang(lang: ViewerLang): Promise<void> {
  try {
    const local = chromeApi()?.storage?.local;
    const ctx = (await local?.get([CONTEXT_KEY]))?.[CONTEXT_KEY];
    if (typeof ctx === "object" && ctx !== null) await local?.set?.({ [CONTEXT_KEY]: { ...ctx, viewer_lang: lang } });
  } catch {
    // storage unavailable: the hub already has the new language for this meeting.
  }
}

/** Halo badge, its menu (points language + legend) and the notes-ready
 * toast, fixed top-left above Meet. Karim 2026-11-02: one Halo pill holds
 * everything; the consent notice moved to the toolbar popup.
 * Refreshes after every Port message (registered after boot's listener, so
 * the overlay store is already updated). Returns the refresh function. */
export function mountControls(
  doc: Document,
  overlay: Overlay,
  port: PortIn,
): () => void {
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = "") => {
    const e = doc.createElement(tag);
    e.className = cls;
    e.textContent = text;
    return e;
  };
  const button = (cls: string, text: string, onClick: () => void) => {
    const b = make("button", cls, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  };

  // Badge (never cut, DECISIONS 8): a click opens the Halo menu.
  const bar = make("div", "halo-controls");
  const menu = make("div", "halo-menu");
  menu.id = "halo-menu";
  menu.hidden = true;
  const showMenu = (open: boolean): void => {
    menu.hidden = !open;
    badge.setAttribute("aria-expanded", String(open));
  };
  const badge = button("halo-badge", "", () => showMenu(menu.hidden));
  doc.addEventListener("click", (ev) => {
    if (!menu.hidden && !(ev.target as Element).closest?.(".halo-controls")) showMenu(false);
  });
  badge.setAttribute("aria-expanded", "false");
  badge.setAttribute("aria-controls", "halo-menu");
  const toast = make("div", "halo-toast");
  toast.setAttribute("role", "status");
  const link = make("a", "", "Open notes");
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  const dismiss = button("halo-dismiss", "×", () => {
    overlay.notesToast = null;
    refresh();
  });
  dismiss.setAttribute("aria-label", "Dismiss");
  toast.append(make("span", "", "Meeting notes are ready."), link, dismiss);
  // Points language (later turns only; points already shown keep theirs).
  const lang = make("select", "halo-lang");
  lang.setAttribute("aria-label", "Points language");
  for (const [value, text] of [["en", "Points: English"], ["ar", "النقاط: العربية"]]) {
    const option = make("option", "", text);
    option.value = value;
    lang.append(option);
  }
  readViewerLang().then((v) => { lang.value = v; });
  lang.addEventListener("change", () => {
    const v: ViewerLang = lang.value === "ar" ? "ar" : "en";
    port.postMessage({ type: "set_viewer_lang", viewer_lang: v });
    void saveViewerLang(v);
  });

  // Legend (Karim 2026-11-01): what each colour and glyph means.
  const legend = make("div", "halo-legend");
  for (const [u, word] of [["urgent", "Urgent (stays until you archive it)"], ["medium", "Medium"], ["later", "Later"]] as const) {
    const swatch = make("span", "halo-swatch");
    swatch.style.background = URGENCY_COLORS[u];
    legend.append(swatch, make("span", "", word));
  }
  for (const [k, word] of [["point", "Point"], ["question", "Question"], ["decision", "Decision"], ["pushback", "Pushback"]] as const) {
    legend.append(make("span", "halo-kind", KIND_GLYPHS[k]), make("span", "", word));
  }
  menu.append(lang, legend);

  bar.append(badge, toast, menu);
  doc.body.append(bar);

  const refresh = (): void => {
    badge.textContent = overlay.badgeText();
    const href = notesHref((overlay.notesToast as { url?: unknown } | null)?.url);
    toast.hidden = href === null;
    if (href) link.href = href;
  };
  port.onMessage.addListener(refresh);
  refresh();
  return refresh;
}
