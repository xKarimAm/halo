// Background service worker (hub_capture): owns the offscreen document
// that hosts the hub. Start is handed over through chrome.storage
// ("halo.pendingStart"): runtime messages are not reliably delivered to
// offscreen documents, storage.onChanged is. The worker records the
// request and makes sure the document exists; the hub consumes it there.
import { defineBackground } from "wxt/sandbox";

declare const chrome: any;

export const PENDING_START_KEY = "halo.pendingStart";

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
    if (msg?.type !== "halo/hub.start") return;
    void (async () => {
      await chrome.storage.local.set({ [PENDING_START_KEY]: { msg, at: Date.now() } });
      const has = await chrome.offscreen.hasDocument().catch(() => false);
      if (!has) {
        await chrome.offscreen.createDocument({
          url: "offscreen.html",
          reasons: ["USER_MEDIA"],
          justification: "Halo hub socket and call capture",
        }).catch(() => {});
      }
    })();
  });
});
