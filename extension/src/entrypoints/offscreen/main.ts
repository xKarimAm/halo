// Offscreen entrypoint: boots the hub with the real WebSocket + storage.
// Thin wrapper; all behaviour (incl. reconnect/backoff/pairing gate) lives
// in hub_capture/hub.ts (unit-tested).
import { HUB_START_MESSAGE, Hub, handleHubRuntimeMessage } from "../../hub_capture/hub";
import type { ToPagePortMessage } from "../../../../contracts/ext/port";

declare const chrome: any;

const ports = new Set<any>();
const socket = {
  ws: null as WebSocket | null,
  _onMessage: null as null | ((ev?: unknown) => void),
  _onOpen: null as null | ((ev?: unknown) => void),
  _onClose: null as null | ((ev?: unknown) => void),
  connect(): void {
    this.ws = new WebSocket("ws://127.0.0.1:8765/ws");
    this.ws.binaryType = "arraybuffer";
    this.ws.addEventListener("message", (ev) => this._onMessage?.(ev));
    this.ws.addEventListener("open", (ev) => this._onOpen?.(ev));
    this.ws.addEventListener("close", (ev) => this._onClose?.(ev));
  },
  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  },
  send(data: string): void {
    if (this.isOpen()) this.ws?.send(data); // never send on a non-open socket
  },
  sendBinary(data: Uint8Array): void {
    if (this.isOpen()) this.ws?.send(data);
  },
  addEventListener(type: string, fn: (ev?: unknown) => void): void {
    if (type === "message") this._onMessage = fn;
    if (type === "open") this._onOpen = fn;
    if (type === "close") this._onClose = fn;
  },
};

const hubDeps = {
  socket,
  now: () => Date.now(),
  uuid: () => crypto.randomUUID(),
  toPage: (msg: ToPagePortMessage) => { for (const p of ports) p.postMessage(msg); },
  storage: {
    set: (k: string, v: unknown) => chrome.storage.local.set({ [k]: v }),
    get: (k: string) => chrome.storage.local.get(k),
  },
  token: "", // filled from chrome.storage.local ("halo.token") at Start
  extVersion: chrome.runtime.getManifest().version,
};
const hub = new Hub(hubDeps);
// Boot stamp: Meet content scripts (re)connect their hub Port when this
// changes, and the joined rig uses it to detect a hub that never booted.
chrome.storage.local.set({ "halo.hubBootedAt": Date.now() });

chrome.runtime.onConnect.addListener((port: any) => {
  if (port.name !== "halo-hub") return;
  ports.add(port);
  port.onMessage.addListener((msg: unknown) => hub.onPortMessage(msg as never));
  port.onDisconnect.addListener(() => { ports.delete(port); hub.onPagePortDisconnected(); });
});
function startFrom(msg: Record<string, unknown>): void {
  // Pair with the token the popup stored at pairing time (halo.token).
  chrome.storage.local.get("halo.token", (items: Record<string, unknown>) => {
    hubDeps.token = typeof items?.["halo.token"] === "string" ? items["halo.token"] : "";
    hub.connect();
    handleHubRuntimeMessage(hub, msg);
  });
}

chrome.runtime.onMessage.addListener((msg: Record<string, unknown>) => {
  if (msg.type === HUB_START_MESSAGE) {
    startFrom(msg);
    return;
  }
  return handleHubRuntimeMessage(hub, msg);
});

// Start handoff via storage (background worker records "halo.pendingStart";
// runtime messages are not reliably delivered to offscreen documents).
chrome.storage.local.get("halo.pendingStart", (items: Record<string, unknown>) => {
  const pending = items?.["halo.pendingStart"] as { msg: Record<string, unknown> } | undefined;
  if (pending?.msg) {
    chrome.storage.local.remove("halo.pendingStart");
    startFrom(pending.msg);
  }
});
chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>) => {
  const pending = changes["halo.pendingStart"]?.newValue as { msg: Record<string, unknown> } | undefined;
  if (pending?.msg) startFrom(pending.msg);
});
setInterval(() => hub.pumpOutbox(), 500);
