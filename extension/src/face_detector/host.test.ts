import { describe, expect, it } from "vitest";
import {
  createFaceHost,
  isFacesUpdateMessage,
  type HostDoc,
  type IframeLike,
} from "./host";
import type { FacesUpdate } from "../../../contracts/ext/gen/types";

const UPDATE: FacesUpdate = {
  tile_id: "t1", frame_ts_ms: 100, engine: "mediapipe",
  space: { frame_w: 640, frame_h: 360 },
  face: { box: [0.38, 0.18, 0.24, 0.42], head_anchor: [0.5, 0.3], conf: 0.9 },
};

describe("isFacesUpdateMessage", () => {
  it("accepts a full faces.update and a null-face update", () => {
    expect(isFacesUpdateMessage(UPDATE)).toBe(true);
    expect(isFacesUpdateMessage({ ...UPDATE, face: null })).toBe(true);
  });

  it("rejects garbage, wrong engines and cross-talk", () => {
    expect(isFacesUpdateMessage(null)).toBe(false);
    expect(isFacesUpdateMessage("faces.update")).toBe(false);
    expect(isFacesUpdateMessage({ tile_id: 42 })).toBe(false);
    expect(isFacesUpdateMessage({ ...UPDATE, engine: "clip" })).toBe(false);
    expect(isFacesUpdateMessage({ type: "backend.envelope" })).toBe(false);
  });
});

interface FakeFrame {
  posted: { message: unknown; transfer: unknown[] }[];
  contentWindow: {
    postMessage: (message: unknown, targetOrigin: string, transfer?: unknown[]) => void;
  } | null;
  removed: boolean;
  onload: (() => void) | null;
  src: string;
  attrs: Record<string, string>;
  style: { display: string };
}

function fakeDoc(): { doc: HostDoc; frame: FakeFrame; fireMessage: (ev: unknown) => void } {
  const listeners = new Set<(ev: { source: unknown; data: unknown }) => void>();
  const frame: FakeFrame = {
    posted: [],
    contentWindow: null,
    removed: false,
    onload: null,
    src: "",
    attrs: {},
    style: { display: "" },
  };
  frame.contentWindow = {
    postMessage: (message: unknown, _targetOrigin: string, transfer: unknown[] = []) => {
      frame.posted.push({ message, transfer });
    },
  };
  const appended: unknown[] = [];
  const doc: HostDoc = {
    createElement: () =>
      ({
        get contentWindow() { return frame.contentWindow; },
        remove: () => { frame.removed = true; },
        get onload() { return frame.onload; },
        set onload(fn: (() => void) | null) { frame.onload = fn; },
        get src() { return frame.src; },
        set src(v: string) { frame.src = v; },
        setAttribute: (k: string, v: string) => { frame.attrs[k] = v; },
        style: frame.style,
      }) as unknown as IframeLike,
    body: { appendChild: (el: unknown) => { appended.push(el); } },
    listenMessage: (fn) => {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
  return { doc, frame, fireMessage: (ev: unknown) => { for (const fn of listeners) fn(ev as never); } };
}

describe("createFaceHost", () => {
  it("appends a hidden iframe with the detector src", () => {
    const { doc, frame } = fakeDoc();
    createFaceHost({ iframeSrc: "chrome-extension://x/face-detector.html", doc, onUpdate: () => {} });
    expect(frame.src).toBe("chrome-extension://x/face-detector.html");
    expect(frame.attrs["aria-hidden"]).toBe("true");
    expect(frame.style.display).toBe("none");
  });

  it("drops frames before load, transfers bitmaps after", () => {
    const { doc, frame } = fakeDoc();
    const host = createFaceHost({ iframeSrc: "fd.html", doc, onUpdate: () => {} });
    const bitmap = { marker: "b1" } as unknown as ImageBitmap;
    host.postFrame({ tile_id: "t1", ts_ms: 0, frame_w: 640, frame_h: 360, bitmap });
    expect(frame.posted).toHaveLength(0); // not loaded yet: dropped
    frame.onload?.();
    expect(host.ready).toBe(true);
    host.postFrame({ tile_id: "t1", ts_ms: 100, frame_w: 640, frame_h: 360, bitmap });
    expect(frame.posted).toHaveLength(1);
    expect(frame.posted[0].message).toMatchObject({ tile_id: "t1", ts_ms: 100 });
    expect(frame.posted[0].transfer).toEqual([bitmap]); // zero-copy transfer
  });

  it("forwards faces.update from the frame window, ignores everything else", () => {
    const { doc, frame, fireMessage } = fakeDoc();
    const seen: FacesUpdate[] = [];
    createFaceHost({ iframeSrc: "fd.html", doc, onUpdate: (u) => seen.push(u) });
    frame.onload?.();
    fireMessage({ source: frame.contentWindow, data: UPDATE });
    expect(seen).toEqual([UPDATE]);
    fireMessage({ source: frame.contentWindow, data: { type: "backend.envelope" } });
    fireMessage({ source: {}, data: UPDATE }); // not from the frame window
    expect(seen).toHaveLength(1);
  });

  it("dispose removes the listener and the iframe", () => {
    const { doc, frame, fireMessage } = fakeDoc();
    const seen: FacesUpdate[] = [];
    const host = createFaceHost({ iframeSrc: "fd.html", doc, onUpdate: (u) => seen.push(u) });
    host.dispose();
    expect(frame.removed).toBe(true);
    fireMessage({ source: frame.contentWindow, data: UPDATE });
    expect(seen).toHaveLength(0);
  });
});
