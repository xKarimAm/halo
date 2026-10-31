// Face-host: the content-script side of the hidden face-detector iframe.
// The content script cannot run MediaPipe itself (Meet's page CSP blocks
// the detector's WASM), so frames cross into the extension-origin iframe
// as transferred ImageBitmaps and faces.update comes back. Owns the iframe
// element, the transfer post and the reply filter; the hold/fallback policy
// still lives in FaceBridge downstream.
import type { FacesUpdate } from "../../../contracts/ext/gen/types";
import type { TileFrameLike } from "./detector";

export interface FaceFramePost extends TileFrameLike {
  bitmap: ImageBitmap;
}

export interface IframeLike {
  contentWindow: {
    postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void;
  } | null;
  remove(): void;
  onload: ((this: GlobalEventHandlers, ev: Event) => unknown) | null;
  src: string;
  setAttribute(name: string, value: string): void;
  style: { display: string };
}

/** Minimal DOM surface the host needs (production: documentHostDoc). */
export interface HostDoc {
  createElement(tag: "iframe"): IframeLike;
  body: { appendChild(el: unknown): void };
  listenMessage(fn: (ev: { source: unknown; data: unknown }) => void): () => void;
}

/** Production HostDoc over a real document. */
export function documentHostDoc(doc: Document): HostDoc {
  return {
    createElement: (tag) => doc.createElement(tag),
    body: doc.body,
    listenMessage: (fn) => {
      const handler = (ev: MessageEvent) => fn(ev);
      window.addEventListener("message", handler);
      return () => window.removeEventListener("message", handler);
    },
  };
}

export function isFacesUpdateMessage(msg: unknown): msg is FacesUpdate {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  if (typeof m.tile_id !== "string" || typeof m.frame_ts_ms !== "number") return false;
  if (m.engine !== "mediapipe" && m.engine !== "yunet" && m.engine !== "sam") return false;
  if (!m.space || typeof m.space !== "object") return false;
  return "face" in m; // face itself may be null (Frame mode for that tile)
}

export interface FaceHost {
  readonly ready: boolean;
  postFrame(frame: FaceFramePost): void;
  dispose(): void;
}

export function createFaceHost(options: {
  iframeSrc: string;
  doc: HostDoc;
  onUpdate: (update: FacesUpdate) => void;
}): FaceHost {
  const iframe = options.doc.createElement("iframe");
  iframe.src = options.iframeSrc;
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("tabindex", "-1");
  iframe.style.display = "none";
  let loaded = false;
  iframe.onload = () => {
    loaded = true;
  };
  options.doc.body.appendChild(iframe);
  const off = options.doc.listenMessage((ev) => {
    if (!iframe.contentWindow || ev.source !== iframe.contentWindow) return;
    if (isFacesUpdateMessage(ev.data)) options.onUpdate(ev.data);
  });
  return {
    get ready(): boolean {
      return loaded && iframe.contentWindow !== null;
    },
    postFrame(frame: FaceFramePost): void {
      const target = iframe.contentWindow;
      if (!loaded || !target) return; // pre-ready frames drop; 10 fps resumes at once
      target.postMessage(frame, "*", [frame.bitmap]);
    },
    dispose(): void {
      off();
      iframe.remove();
    },
  };
}
