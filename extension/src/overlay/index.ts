// Meet-page boot (called by the hub content wrapper): wires Port envelopes
// and in-tab feeds into the overlay and renders into the Meet page.
import type { ToPagePortMessage } from "../../../contracts/ext/port";
import {
  CONSENT_NOTICE, Overlay, SystemClock, copyConsentNotice, notesHref,
  type DocLike, type El, type UrgencyStyle,
} from "./overlay";
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
  mountControls(document, overlay, context.port);
  return overlay;
}

type PortIn = { onMessage: { addListener(fn: (msg: unknown) => void): void } };

/** Badge, consent dialog and notes-ready toast, fixed top-left above Meet.
 * Refreshes after every Port message (registered after boot's listener, so
 * the overlay store is already updated). Returns the refresh function. */
export function mountControls(
  doc: Document,
  overlay: Overlay,
  port: PortIn,
  clipboard: { writeText(text: string): unknown } = navigator.clipboard,
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

  // Consent dialog (DECISIONS 10): editable notice, "Copy notice" puts it on
  // the clipboard; the user pastes it into Meet chat. Meet chat is never touched.
  const dialog = make("dialog", "halo-dialog");
  dialog.setAttribute("aria-labelledby", "halo-consent-title");
  const title = make("h2", "", "Consent notice");
  title.id = "halo-consent-title";
  const help = make("p", "", "Copy this notice, then paste it into Meet chat.");
  const notice = make("textarea", "halo-notice");
  notice.value = CONSENT_NOTICE;
  notice.dir = "auto";
  notice.rows = 7;
  notice.setAttribute("aria-label", "Consent notice text");
  const copyStatus = make("p", "halo-copy-status");
  copyStatus.setAttribute("role", "status");
  const actions = make("div", "halo-actions");
  actions.append(
    button("halo-btn", "Close", () => dialog.close()),
    button("halo-btn halo-primary", "Copy notice", async () => {
      try {
        await copyConsentNotice(clipboard, notice.value);
        copyStatus.textContent = "Copied. Paste it into Meet chat.";
      } catch {
        copyStatus.textContent = "Copy failed. Select the text and copy it.";
      }
    }),
  );
  dialog.append(title, help, notice, copyStatus, actions);

  // Badge (never cut, DECISIONS 8) + the consent entry + the notes toast.
  const bar = make("div", "halo-controls");
  const badge = make("span", "halo-badge");
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
  bar.append(
    badge,
    button("halo-btn", "Consent notice", () => {
      copyStatus.textContent = "";
      dialog.showModal();
    }),
    toast,
  );
  doc.body.append(bar, dialog);

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
