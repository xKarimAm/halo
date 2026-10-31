// Offscreen entrypoint: boots the hub with the real WebSocket + storage.
// Thin wrapper; all behaviour (incl. reconnect/backoff/pairing gate) lives
// in hub_capture/hub.ts (unit-tested).
import { HUB_START_MESSAGE, HUB_STOP_MESSAGE, Hub, handleHubRuntimeMessage } from "../../hub_capture/hub";
import { adaptAudioContext, startLiveCapture } from "../../hub_capture/capture_live";
import { MIC_PORT_NAME, readMicFrame } from "../../hub_capture/mic_relay";
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

let meeting: AbortController | null = null; // the running meeting's capture

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
  // Every meeting.ended (Stop, left the call, tab closed, another call's
  // Start) also stops that meeting's tab + mic capture.
  onEnded: () => { meeting?.abort(); meeting = null; },
};
const hub = new Hub(hubDeps);

function storageSet(items: Record<string, unknown>): void {
  chrome.runtime.sendMessage({ type: "halo/storage.set", items });
}

chrome.runtime.onConnect.addListener((port: any) => {
  if (port.name === MIC_PORT_NAME) {
    // Mic stream 1, captured by the Meet content script (see mic_relay.ts).
    port.onMessage.addListener((msg: unknown) => {
      const frame = readMicFrame(msg);
      if (frame) hub.sendAudio("mic", frame.pcm, frame.ts, port.sender?.tab?.id);
    });
    return;
  }
  if (port.name !== "halo-hub") return;
  ports.add(port);
  port.onMessage.addListener((msg: unknown) => hub.onPortMessage(msg as never, port.sender?.tab?.id));
  port.onDisconnect.addListener(() => { ports.delete(port); hub.onPagePortDisconnected(); });
});
type StartHandoff = {
  start: Record<string, unknown>; token: string; extVersion?: string; context?: MeetingContext;
} | null | undefined;

function startFrom(handoff: StartHandoff): void {
  if (!handoff?.start || handoff.start.type !== HUB_START_MESSAGE) return;
  const msg = handoff.start;
  // Pair with the token the popup stored at pairing time (halo.token).
  hubDeps.token = handoff.token;
  hubDeps.extVersion = handoff.extVersion ?? "";
  hub.connect(); // once per hub: a repeat Start never opens a second socket
  // A repeat Start for the running call keeps it (and its capture); a Start
  // for another call ends the old meeting (onEnded stops its capture).
  if (!handleHubRuntimeMessage(hub, msg)) return;
  const current = (meeting = new AbortController());
  if (handoff.context) hub.onPortMessage({ type: "meeting.context", data: handoff.context });
  // Live audio: tab stream 0 (+ local replay). The mic (stream 1) comes
  // from the Meet content script over the "halo-mic" Port: this document
  // cannot show a permission prompt. Never blocks the meeting: without a
  // stream id the hub runs on without tab audio.
  void startLiveCapture(
    typeof msg.streamId === "string" ? msg.streamId : undefined,
    {
      mediaDevices: navigator.mediaDevices,
      createContext: () => adaptAudioContext(new AudioContext()),
      sendAudio: (stream, pcm, tsMs) => hub.sendAudio(stream, pcm, tsMs),
      setMicState: () => {}, // the mic is captured in the Meet tab
      now: () => Date.now(),
      signal: current.signal,
      // The captured Meet tab closed: the hub is the emitter of record for
      // meeting.ended, and the mic must not stay open.
      onTabEnded: () => {
        if (meeting === current) hub.stop("tab_closed"); // else an older meeting's tab
      },
    },
    { mic: false },
  );
}

// The popup's "halo/hub.start" goes to the worker, never straight here:
// the worker stores it and nudges a running hub, which pulls it ("take").
chrome.runtime.onMessage.addListener((msg: Record<string, unknown>) => {
  if (msg.type === HUB_STOP_MESSAGE) hub.stop("left"); // the popup's Stop button
  if (msg.type === "halo/offscreen.pull") {
    chrome.runtime.sendMessage({ type: "halo/offscreen.take" }, (handoff: StartHandoff) => startFrom(handoff));
  }
  return false;
});
// Listeners are in place: pull the Start that created this document.
chrome.runtime.sendMessage({ type: "halo/offscreen.ready" }, (handoff: StartHandoff) => startFrom(handoff));
setInterval(() => hub.pumpOutbox(), 500);
