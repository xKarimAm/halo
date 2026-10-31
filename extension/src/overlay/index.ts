// Meet-page boot (called by the hub content wrapper): wires Port envelopes
// and in-tab feeds into the overlay and renders into the Meet page.
import type { ToPagePortMessage } from "../../../contracts/ext/port";
import type { FacesUpdate } from "../../../contracts/ext/gen/types";
import { Overlay, SystemClock, type DocLike, type El, type OverlayMode, type UrgencyStyle } from "./overlay";
import { OVERLAY_CSS } from "./tokens";

// Viewer urgency-mark setting, shared with the setup panel (no ambient
// chrome types in this lane: structural access keeps the two lanes' globals
// from colliding).
export const URGENCY_STYLE_KEY = "halo.urgencyStyle";
// Viewer Face|Frame toggle, shared with the setup panel the same way:
// "face" (default) anchors bubbles over detected faces, "frame" pins every
// tile. The hub wiring reads it through the Overlay, never the Port.
export const OVERLAY_MODE_KEY = "halo.overlayMode";
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

export async function readOverlayMode(): Promise<OverlayMode> {
  try {
    const v = (await chromeApi()?.storage?.local?.get([OVERLAY_MODE_KEY]))?.[OVERLAY_MODE_KEY];
    return v === "frame" ? "frame" : "face"; // default: Face mode
  } catch {
    return "face";
  }
}

/** Apply the stored mode now, then switch live on storage.onChanged. */
export function watchOverlayMode(
  overlay: Overlay,
  rerender: () => void,
): void {
  readOverlayMode().then((mode) => {
    overlay.setOverlayMode(mode);
    rerender();
  });
  try {
    chromeApi()?.storage?.onChanged?.addListener((changes) => {
      if (OVERLAY_MODE_KEY in changes) {
        overlay.setOverlayMode(changes[OVERLAY_MODE_KEY].newValue);
        rerender();
      }
    });
  } catch {
    // storage events unavailable (tests): the initial read still applies.
  }
}

export function boot(context: { port: { onMessage: { addListener(fn: (msg: unknown) => void): void } } }): {
  overlay: Overlay;
  /** faces.update + Bridge policy output lands here (re-renders the layer). */
  onFacesUpdate: (update: FacesUpdate) => void;
} {
  const overlay = new Overlay(new SystemClock());
  const doc = document as unknown as DocLike;
  const style = document.createElement("style");
  style.textContent = OVERLAY_CSS;
  document.head.appendChild(style);
  const root = document.createElement("div") as unknown as El;
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
  watchOverlayMode(overlay, rerender);
  const onFacesUpdate = (update: FacesUpdate): void => {
    overlay.applyFaces(update);
    rerender();
  };
  return { overlay, onFacesUpdate };
}
