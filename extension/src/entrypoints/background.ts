// Background service worker (hub_capture): owns the offscreen document
// that hosts the hub, and does the hub's storage. Offscreen documents get
// only chrome.runtime ("The runtime API is the only extensions API
// supported by offscreen documents", developer.chrome.com offscreen API
// reference), so the hub never touches chrome.storage itself:
// - Start: the worker records "halo.pendingStart". The hub always pulls
//   it: a freshly created hub with "halo/offscreen.ready" once its
//   listeners exist; an already open hub is nudged with
//   "halo/offscreen.pull" and answers "halo/offscreen.take". Never pushed,
//   so a Start that lands while the document is still booting is not lost.
// - The handoff carries the saved "halo.context": the popup's Port was
//   opened before the hub existed, so its meeting.context never arrived.
// - Writes: the hub sends "halo/storage.set" and the worker applies them.
import { defineBackground } from "wxt/sandbox";

declare const chrome: any;

export const PENDING_START_KEY = "halo.pendingStart";
const TOKEN_KEY = "halo.token";
const CONTEXT_KEY = "halo.context";

/** Consume the pending Start (once) together with the pairing token and saved context. */
async function takeStart(): Promise<{ start: unknown; token: string; extVersion: string; context?: unknown } | null> {
  const items = await chrome.storage.local.get([PENDING_START_KEY, TOKEN_KEY, CONTEXT_KEY]);
  const pending = items?.[PENDING_START_KEY] as { msg?: unknown } | undefined;
  if (!pending?.msg) return null;
  await chrome.storage.local.remove(PENDING_START_KEY);
  const token = typeof items?.[TOKEN_KEY] === "string" ? items[TOKEN_KEY] : "";
  // getManifest is not available in the offscreen document either.
  return { start: pending.msg, token, extVersion: chrome.runtime.getManifest().version, context: items?.[CONTEXT_KEY] };
}

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener(
    (msg: { type?: string; items?: Record<string, unknown> }, _sender: unknown, reply: (r: unknown) => void) => {
      if (msg?.type === "halo/storage.set" && msg.items) {
        void chrome.storage.local.set(msg.items);
        return false;
      }
      if (msg?.type === "halo/offscreen.ready" || msg?.type === "halo/offscreen.take") {
        // Boot stamp: Meet content scripts (re)connect their hub Port on it,
        // and the joined rig uses it to detect a hub that never booted.
        if (msg.type === "halo/offscreen.ready") void chrome.storage.local.set({ "halo.hubBootedAt": Date.now() });
        void takeStart().then(reply, () => reply(null));
        return true; // async reply
      }
      if (msg?.type !== "halo/hub.start") return false;
      void (async () => {
        await chrome.storage.local.set({ [PENDING_START_KEY]: { msg, at: Date.now() } });
        // runtime.getContexts (Chrome 116+), as the offscreen docs sample does:
        // offscreen.hasDocument is documented only from Chrome 150.
        const open = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }).catch(() => []);
        const has = open.length > 0;
        if (!has) {
          await chrome.offscreen.createDocument({
            url: "offscreen.html",
            reasons: ["USER_MEDIA"],
            justification: "Halo hub socket and call capture",
          }).catch((err: unknown) => console.error("halo: offscreen createDocument failed", err));
          return; // the new hub pulls the pending Start on "halo/offscreen.ready"
        }
        // A hub still booting has no listener yet (the send rejects): it
        // pulls on "halo/offscreen.ready" itself, and the Start is still pending.
        chrome.runtime.sendMessage({ type: "halo/offscreen.pull" }).catch(() => {});
      })();
      return false;
    },
  );
});
