/**
 * Thin WXT entry wrapper for the toolbar popup (setup_panel lane).
 * Boots the popup with chrome-backed deps. The Start-click capture handoff
 * and participant-name delivery arrive with hub_capture (open issues);
 * until then Start and prefill use the injected placeholders in popup.ts.
 */
import { initPopup } from "../../setup_panel/popup";
import { chromeSetupStorage } from "../../setup_panel/storage";

const root = document.getElementById("halo-setup");
if (!root) {
  throw new Error("Halo setup: missing #halo-setup root");
}
if (typeof chrome === "undefined" || !chrome) {
  throw new Error("Halo setup: chrome APIs unavailable");
}

const port = chrome.runtime.connect({ name: "halo.setup" });

await initPopup(root, {
  storage: chromeSetupStorage(chrome.storage.local),
  port,
  // TODO(module:hub_capture): participant names from adapter tiles via the hub.
  listParticipants: () => [],
  // TODO(module:hub_capture): Start-click capture handoff (user gesture).
  onStart: () => {},
});
