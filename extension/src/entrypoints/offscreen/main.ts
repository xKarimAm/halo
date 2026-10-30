// Offscreen entrypoint: boots the hub with the real WebSocket + storage.
// Thin wrapper; all behaviour (incl. reconnect/backoff/pairing gate) lives
// in hub_capture/hub.ts (unit-tested).
import { HUB_START_MESSAGE, Hub, handleHubRuntimeMessage } from "../../hub_capture/hub";

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

const hub = new Hub({
  socket,
  now: () => Date.now(),
  uuid: () => crypto.randomUUID(),
  toPage: (msg) => { for (const p of ports) p.postMessage(msg); },
  storage: {
    set: (k, v) => chrome.storage.local.set({ [k]: v }),
    get: (k) => chrome.storage.local.get(k),
  },
  token: "",
  extVersion: chrome.runtime.getManifest().version,
});

chrome.runtime.onConnect.addListener((port: any) => {
  if (port.name !== "halo-hub") return;
  ports.add(port);
  port.onMessage.addListener((msg: unknown) => hub.onPortMessage(msg as never));
  port.onDisconnect.addListener(() => { ports.delete(port); hub.onPagePortDisconnected(); });
});
chrome.runtime.onMessage.addListener((msg: Record<string, unknown>) => {
  if (msg.type === HUB_START_MESSAGE) hub.connect();
  return handleHubRuntimeMessage(hub, msg);
});
setInterval(() => hub.pumpOutbox(), 500);
