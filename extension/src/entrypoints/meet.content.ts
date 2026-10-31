// Meet content-script wrapper (owned by hub_capture): boots the in-tab
// modules on the shared hub Port. Frame mode needs the adapter (tiles,
// speaking) plus the overlay; frame_source/face_detector join through
// their own seams when Face mode is in scope.
//
// The Port is reconnectable: a content script that loads before the hub
// page exists connects to nobody (the hub's onConnect never fires for
// it, and posting on that dead Port throws). The wrapper keeps the live
// Port behind a proxy, retries the connect until one survives, and
// reconnects at once when the hub page stamps "halo.hubBootedAt" in
// storage at boot. Overlay/adapter are booted once behind the proxy.
import { defineContentScript } from "wxt/sandbox";
import { MeetDomAdapter } from "../meet_adapter/meet_adapter";
import { createPortSync } from "../meet_adapter/port_sync";
import { boot as bootOverlay } from "../overlay/index";

declare const chrome: any;

const MAX_CONNECT_ATTEMPTS = 60;

export async function bootMeetPage(): Promise<void> {
  const listeners = new Set<(msg: unknown) => void>();
  let current: any = null;
  let attempts = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const portProxy = {
    postMessage: (msg: unknown) => {
      try { current?.postMessage(msg); } catch { /* dead Port: drop */ }
    },
    onMessage: {
      addListener: (fn: (msg: unknown) => void) => { listeners.add(fn); },
    },
  };
  const overlay = bootOverlay({ port: portProxy });
  const adapter = new MeetDomAdapter({});
  overlay.applyTiles({ tiles: adapter.tiles() });
  adapter.onTiles((tiles) => overlay.applyTiles({ tiles }));
  adapter.onSpeaking((event) => overlay.applySpeakerActive(event));
  createPortSync(portProxy, adapter);

  const connect = (): void => {
    attempts += 1;
    try { current?.disconnect?.(); } catch { /* already dead */ }
    current = chrome.runtime.connect({ name: "halo-hub" });
    const port = current;
    port.onMessage.addListener((msg: unknown) => {
      for (const fn of listeners) fn(msg);
    });
    port.onDisconnect.addListener(() => {
      if (current === port) current = null;
      if (attempts < MAX_CONNECT_ATTEMPTS) {
        retryTimer = setTimeout(connect, 1500);
      }
    });
    portProxy.postMessage({ type: "tiles.snapshot", data: { tiles: adapter.tiles() } });
  };
  connect();
  chrome.storage.onChanged.addListener((changes: Record<string, unknown>) => {
    if (!("halo.hubBootedAt" in changes)) return;
    attempts = 0;
    if (retryTimer) clearTimeout(retryTimer);
    connect();
  });
}

export default defineContentScript({
  matches: ["https://meet.google.com/*"],
  main() {
    void bootMeetPage();
  },
});
