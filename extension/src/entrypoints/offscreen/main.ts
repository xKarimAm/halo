// Offscreen entrypoint: boots the hub with the real WebSocket + storage.
// Thin wrapper; all behaviour lives in hub_capture/hub.ts (unit-tested).
import { HUB_START_MESSAGE, Hub, handleHubRuntimeMessage } from "../../hub_capture/hub";

declare const chrome: any;

const ports = new Set<any>();
let hubRef: Hub | null = null;
const socket = {
  ws: null as WebSocket | null,
  send(data: string): void { this.ws?.send(data); },
  sendBinary(data: Uint8Array): void { this.ws?.send(data); },
  addEventListener(type: string, fn: (ev?: unknown) => void): void {
    if (type === "message") this._onMessage = fn;
    if (type === "close") this._onClose = fn;
  },
  _onMessage: null as null | ((ev?: unknown) => void),
  _onClose: null as null | ((ev?: unknown) => void),
  open(url: string): void {
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.ws.addEventListener("message", (ev) => this._onMessage?.(ev));
    this.ws.addEventListener("close", () => this._onClose?.());
    this.ws.addEventListener("open", () => hubRef?.connect());
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
hubRef = hub;

chrome.runtime.onConnect.addListener((port: any) => {
  if (port.name !== "halo-hub") return;
  ports.add(port);
  port.onMessage.addListener((msg: unknown) => hub.onPortMessage(msg as never));
  port.onDisconnect.addListener(() => { ports.delete(port); hub.onPagePortDisconnected(); });
});
chrome.runtime.onMessage.addListener((msg: Record<string, unknown>) => {
  if (msg.type === HUB_START_MESSAGE) socket.open("ws://127.0.0.1:8765/ws");
  return handleHubRuntimeMessage(hub, msg);
});
setInterval(() => hub.pumpOutbox(), 500);
