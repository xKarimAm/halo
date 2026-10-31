// Background service worker (hub_capture): owns the offscreen document
// that hosts the hub, and does the hub's storage. Offscreen documents get
// only chrome.runtime ("The runtime API is the only extensions API
// supported by offscreen documents", developer.chrome.com offscreen API
// reference), so the hub never touches chrome.storage itself:
// - Start: the worker records "halo.pendingStart". A freshly created hub
//   pulls it with "halo/offscreen.ready" once its listeners exist (no
//   delivery race); an already running hub gets "halo/offscreen.start".
// - Writes: the hub sends "halo/storage.set" and the worker applies them.
import { defineBackground } from "wxt/sandbox";

declare const chrome: any;

export const PENDING_START_KEY = "halo.pendingStart";
const TOKEN_KEY = "halo.token";

/** Consume the pending Start (once) together with the pairing token. */
async function takeStart(): Promise<{ start: unknown; token: string; extVersion: string } | null> {
  const items = await chrome.storage.local.get([PENDING_START_KEY, TOKEN_KEY]);
  const pending = items?.[PENDING_START_KEY] as { msg?: unknown } | undefined;
  if (!pending?.msg) return null;
  await chrome.storage.local.remove(PENDING_START_KEY);
  const token = typeof items?.[TOKEN_KEY] === "string" ? items[TOKEN_KEY] : "";
  // getManifest is not available in the offscreen document either.
  return { start: pending.msg, token, extVersion: chrome.runtime.getManifest().version };
}

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener(
    (msg: { type?: string; items?: Record<string, unknown> }, _sender: unknown, reply: (r: unknown) => void) => {
      if (msg?.type === "halo/storage.set" && msg.items) {
        void chrome.storage.local.set(msg.items);
        return false;
      }
      if (msg?.type === "halo/offscreen.ready") {
        // Boot stamp: Meet content scripts (re)connect their hub Port on it,
        // and the joined rig uses it to detect a hub that never booted.
        void chrome.storage.local.set({ "halo.hubBootedAt": Date.now() });
        void takeStart().then(reply, () => reply(null));
        return true; // async reply
      }
      if (msg?.type !== "halo/hub.start") return false;
      void (async () => {
        await chrome.storage.local.set({ [PENDING_START_KEY]: { msg, at: Date.now() } });
        const has = await chrome.offscreen.hasDocument().catch(() => false);
        if (!has) {
          await chrome.offscreen.createDocument({
            url: "offscreen.html",
            reasons: ["USER_MEDIA"],
            justification: "Halo hub socket and call capture",
          }).catch((err: unknown) => console.error("halo: offscreen createDocument failed", err));
          return; // the new hub pulls the pending Start on "halo/offscreen.ready"
        }
        const next = await takeStart();
        if (next) chrome.runtime.sendMessage({ type: "halo/offscreen.start", ...next });
      })();
      return false;
    },
  );
});
