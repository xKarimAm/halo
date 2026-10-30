// Meet-page boot (called by the hub content wrapper): wires Port envelopes
// and in-tab feeds into the overlay and renders into the Meet page.
import type { ToPagePortMessage } from "../../../contracts/ext/port";
import { Overlay, SystemClock, type DocLike, type El } from "./overlay";
import { OVERLAY_CSS } from "./tokens";

export function boot(context: { port: { onMessage: { addListener(fn: (msg: unknown) => void): void } } }): Overlay {
  const overlay = new Overlay(new SystemClock());
  const doc = document as unknown as DocLike;
  const style = document.createElement("style");
  style.textContent = OVERLAY_CSS;
  document.head.appendChild(style);
  const root = document.createElement("div") as unknown as El;
  document.body.appendChild(root as unknown as Node);
  context.port.onMessage.addListener((msg) => {
    const m = msg as ToPagePortMessage;
    if (m.type === "backend.envelope") {
      overlay.applyEnvelope(m.envelope as never);
      overlay.render(doc, root as El & { children?: El[] });
    }
  });
  return overlay;
}
