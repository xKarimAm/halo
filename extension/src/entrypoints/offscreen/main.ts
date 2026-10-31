// Offscreen entrypoint: boots the hub with the real WebSocket + storage.
// Thin wrapper; all behaviour (incl. reconnect/backoff/pairing gate) lives
// in hub_capture/hub.ts (unit-tested).
import { HUB_START_MESSAGE, Hub, handleHubRuntimeMessage } from "../../hub_capture/hub";
import { adaptAudioContext, startLiveCapture } from "../../hub_capture/capture_live";
import type { ToPagePortMessage } from "../../../../contracts/ext/port";
import type { MeetingContext } from "../../../../contracts/ext/gen/types";

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
  // Offscreen documents get only chrome.runtime: the background worker
  // does every storage write (see entrypoints/background.ts).
  storage: {
    set: (k: string, v: unknown) => storageSet({ [k]: v }),
    get: (_k: string) => undefined, // ponytail: the hub only writes; read via the worker if that changes
  },
  token: "", // the worker hands over "halo.token" with the Start
  extVersion: "", // handed over by the worker with the Start (no getManifest here)
};
const hub = new Hub(hubDeps);

function storageSet(items: Record<string, unknown>): void {
  chrome.runtime.sendMessage({ type: "halo/storage.set", items });
}

chrome.runtime.onConnect.addListener((port: any) => {
  if (port.name !== "halo-hub") return;
  ports.add(port);
  port.onMessage.addListener((msg: unknown) => hub.onPortMessage(msg as never));
  port.onDisconnect.addListener(() => { ports.delete(port); hub.onPagePortDisconnected(); });
});
type StartHandoff = {
  start: Record<string, unknown>; token: string; extVersion?: string; context?: MeetingContext;
} | null | undefined;

let meeting: AbortController | null = null; // the running meeting's capture

function startFrom(handoff: StartHandoff): void {
  if (!handoff?.start || handoff.start.type !== HUB_START_MESSAGE) return;
  const msg = handoff.start;
  // Pair with the token the popup stored at pairing time (halo.token).
  hubDeps.token = handoff.token;
  hubDeps.extVersion = handoff.extVersion ?? "";
  hub.connect(); // once per hub: a repeat Start never opens a second socket
  // A repeat Start for the running call keeps it (and its capture); a Start
  // for another call ended the old meeting, so stop the old capture too.
  if (!handleHubRuntimeMessage(hub, msg)) return;
  meeting?.abort();
  const current = (meeting = new AbortController());
  if (handoff.context) hub.onPortMessage({ type: "meeting.context", data: handoff.context });
  // Live audio: tab stream 0 (+ local replay) and mic stream 1. Never
  // blocks the meeting: without a stream id or a grant the hub runs on
  // without that stream's audio.
  void startLiveCapture(
    typeof msg.streamId === "string" ? msg.streamId : undefined,
    {
      mediaDevices: navigator.mediaDevices,
      createContext: () => adaptAudioContext(new AudioContext()),
      sendAudio: (stream, pcm, tsMs) => hub.sendAudio(stream, pcm, tsMs),
      setMicState: (state) => storageSet({ "halo.micState": state }),
      now: () => Date.now(),
      signal: current.signal,
      // The captured Meet tab closed: the hub is the emitter of record for
      // meeting.ended, and the mic must not stay open.
      onTabEnded: () => {
        if (meeting !== current) return; // an older meeting's tab
        hub.stop("tab_closed");
        current.abort();
      },
    },
  );
}

// The popup's "halo/hub.start" goes to the worker, never straight here:
// the worker stores it and nudges a running hub, which pulls it ("take").
chrome.runtime.onMessage.addListener((msg: Record<string, unknown>) => {
  if (msg.type === "halo/offscreen.pull") {
    chrome.runtime.sendMessage({ type: "halo/offscreen.take" }, (handoff: StartHandoff) => startFrom(handoff));
  }
  return false;
});
// Listeners are in place: pull the Start that created this document.
chrome.runtime.sendMessage({ type: "halo/offscreen.ready" }, (handoff: StartHandoff) => startFrom(handoff));
setInterval(() => hub.pumpOutbox(), 500);
