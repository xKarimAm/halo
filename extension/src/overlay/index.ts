// Meet-page boot (called by the hub content wrapper): wires Port envelopes
// and in-tab feeds into the overlay and renders into the Meet page.
import type { ToPagePortMessage } from "../../../contracts/ext/port";
import { Overlay, SystemClock, type DocLike, type El, type UrgencyStyle } from "./overlay";
import { OVERLAY_CSS } from "./tokens";

// Viewer urgency-mark setting, shared with the setup panel (no ambient
// chrome types in this lane: structural access keeps the two lanes' globals
// from colliding).
export const URGENCY_STYLE_KEY = "halo.urgencyStyle";
interface LocalStore {
  get(keys: string[]): Promise<Record<string, unknown>>;
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

export function boot(context: { port: { onMessage: { addListener(fn: (msg: unknown) => void): void } } }): Overlay {
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
  const rerender = (): void => {
    overlay.render(doc, root as El & { children?: El[] });
  };
  context.port.onMessage.addListener((msg) => {
    const m = msg as ToPagePortMessage;
    if (m.type === "backend.envelope") {
      overlay.applyEnvelope(m.envelope as never);
      rerender();
    }
  });
  watchUrgencyStyle(overlay, rerender);
  return overlay;
}
