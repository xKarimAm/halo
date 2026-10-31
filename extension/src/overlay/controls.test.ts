// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { CONSENT_NOTICE, FakeClock, Overlay, notesHref } from "./overlay";
import { mountControls } from "./index";

// Badge, consent dialog and notes-ready toast (issue #73), on a real DOM.
type Listener = (msg: unknown) => void;
function setup(clipboard: { writeText(t: string): unknown }) {
  const listeners: Listener[] = [];
  const overlay = new Overlay(new FakeClock());
  const port = { onMessage: { addListener: (fn: Listener) => { listeners.push(fn); } } };
  const refresh = mountControls(document, overlay, port, clipboard);
  // What boot() does on the same Port: apply first, then the controls refresh.
  const deliver = (envelope: { id: string; type: string; data: Record<string, unknown> }) => {
    overlay.applyEnvelope(envelope);
    for (const fn of listeners) fn({ type: "backend.envelope", envelope });
  };
  return { overlay, deliver, refresh };
}
const $ = <T extends Element>(sel: string) => document.querySelector(sel) as T;
const byText = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement;
const notesReady = (id: string) => ({
  id, type: "notes.ready",
  data: { meeting_id: "22222222-2222-4222-8222-222222222222", url: "/notes/22222222-2222-4222-8222-222222222222", degraded: false, people: [] },
});

beforeEach(() => { document.body.replaceChildren(); });

describe("badge", () => {
  it("is visible from mount and follows the hidden state", () => {
    const { overlay, refresh } = setup({ writeText: () => {} });
    expect($(".halo-badge").textContent).toBe("Halo");
    overlay.hidden = true;
    refresh();
    expect($(".halo-badge").textContent).toBe("Halo · hidden");
  });
});

describe("notes-ready toast", () => {
  it("is hidden until notes.ready, then links to the notes page in a new tab", () => {
    const { deliver } = setup({ writeText: () => {} });
    const toast = $<HTMLElement>(".halo-toast");
    expect(toast.hidden).toBe(true);
    deliver(notesReady("e1"));
    expect(toast.hidden).toBe(false);
    const a = $<HTMLAnchorElement>(".halo-toast a");
    expect(a.getAttribute("href")).toBe("http://127.0.0.1:8765/notes/22222222-2222-4222-8222-222222222222");
    expect(a.target).toBe("_blank");
    expect(a.rel).toContain("noopener");
  });

  it("dismisses and stays dismissed on other messages", () => {
    const { overlay, deliver } = setup({ writeText: () => {} });
    deliver(notesReady("e1"));
    $<HTMLButtonElement>(".halo-dismiss").click();
    expect($<HTMLElement>(".halo-toast").hidden).toBe(true);
    expect(overlay.notesToast).toBeNull();
    deliver({ id: "e2", type: "system.status", data: {} });
    expect($<HTMLElement>(".halo-toast").hidden).toBe(true);
  });

  it("only links http(s) urls", () => {
    expect(notesHref("/notes/x")).toBe("http://127.0.0.1:8765/notes/x");
    expect(notesHref("javascript:alert(1)")).toBeNull();
    expect(notesHref(undefined)).toBeNull();
  });
});

describe("consent dialog", () => {
  it("opens with the bilingual notice, RTL-safe", () => {
    setup({ writeText: () => {} });
    byText("Consent notice").click();
    expect($<HTMLDialogElement>(".halo-dialog").open).toBe(true);
    const notice = $<HTMLTextAreaElement>(".halo-notice");
    expect(notice.value).toBe(CONSENT_NOTICE);
    expect(notice.dir).toBe("auto");
  });

  it("Copy notice puts the (edited) notice on the clipboard and confirms", async () => {
    const written: string[] = [];
    setup({ writeText: async (t: string) => { written.push(t); } });
    byText("Consent notice").click();
    $<HTMLTextAreaElement>(".halo-notice").value = "edited notice";
    byText("Copy notice").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(written).toEqual(["edited notice"]);
    expect($(".halo-copy-status").textContent).toBe("Copied. Paste it into Meet chat.");
  });

  it("says so when the clipboard refuses", async () => {
    setup({ writeText: async () => { throw new Error("denied"); } });
    byText("Consent notice").click();
    byText("Copy notice").click();
    await new Promise((r) => setTimeout(r, 0));
    expect($(".halo-copy-status").textContent).toBe("Copy failed. Select the text and copy it.");
  });
});
