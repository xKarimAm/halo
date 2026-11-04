// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOffNudge, mountOffNudge, OFF_NUDGE_DELAY_MS } from "./off_nudge";

describe("off nudge: tells the user when Halo is not running in a call", () => {
  let shown: string[];
  let hides: number;
  const make = () => createOffNudge({ show: (k) => shown.push(k), hide: () => { hides += 1; } });
  beforeEach(() => { vi.useFakeTimers(); shown = []; hides = 0; });
  afterEach(() => vi.useRealTimers());

  it("shows 'off' after the delay when the user is in a call and Halo never started", () => {
    const n = make();
    n.setRunning(false);
    n.setInCall(true);
    vi.advanceTimersByTime(OFF_NUDGE_DELAY_MS - 1);
    expect(shown).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(shown).toEqual(["off"]);
  });

  it("stays quiet when Halo starts before the delay", () => {
    const n = make();
    n.setInCall(true);
    vi.advanceTimersByTime(OFF_NUDGE_DELAY_MS / 2);
    n.setRunning(true);
    vi.advanceTimersByTime(OFF_NUDGE_DELAY_MS * 2);
    expect(shown).toEqual([]);
  });

  it("stays quiet outside a call (the lobby, the home screen)", () => {
    const n = make();
    n.setRunning(false);
    vi.advanceTimersByTime(OFF_NUDGE_DELAY_MS * 3);
    expect(shown).toEqual([]);
  });

  it("shows 'stopped' at once when Halo stops mid-call", () => {
    const n = make();
    n.setInCall(true);
    n.setRunning(true);
    n.setRunning(false);
    expect(shown).toEqual(["stopped"]);
  });

  it("hides when Halo starts, and when the call ends", () => {
    const n = make();
    n.setInCall(true);
    vi.advanceTimersByTime(OFF_NUDGE_DELAY_MS);
    n.setRunning(true);
    expect(hides).toBe(1);
    n.setRunning(false);
    n.setInCall(false);
    expect(hides).toBe(2);
  });

  it("'Not this call' keeps it quiet for the rest of the call, and re-arms on the next call", () => {
    const n = make();
    n.setInCall(true);
    vi.advanceTimersByTime(OFF_NUDGE_DELAY_MS);
    n.dismiss();
    n.setRunning(true);
    n.setRunning(false);
    expect(shown).toEqual(["off"]);
    n.setInCall(false);
    n.setInCall(true);
    vi.advanceTimersByTime(OFF_NUDGE_DELAY_MS);
    expect(shown).toEqual(["off", "off"]);
  });

  it("does not repeat while nothing changes", () => {
    const n = make();
    n.setInCall(true);
    n.setInCall(true);
    n.setRunning(false);
    vi.advanceTimersByTime(OFF_NUDGE_DELAY_MS * 4);
    expect(shown).toEqual(["off"]);
  });
});

describe("off nudge toast", () => {
  // Live 2026-11-04: Chrome gave no visible panel and the toast never changed.
  it("says where Start is at once, even when the panel call reports success or never answers", () => {
    for (const onStart of [async () => true, () => new Promise<boolean>(() => {})]) {
      document.body.innerHTML = '<div class="halo-controls"></div>';
      const ui = mountOffNudge(document, { onStart, onDismiss: () => {} });
      ui.show("off");
      const box = document.querySelector<HTMLElement>(".halo-nudge")!;
      box.querySelector<HTMLButtonElement>(".halo-primary")!.click();
      expect(box.textContent).toContain("Click the Halo icon in the toolbar, then Start.");
      expect(box.querySelector<HTMLButtonElement>(".halo-primary")!.hidden).toBe(true);
    }
  });

  it("shows its words with Start Halo, and points at the icon when the panel cannot open", async () => {
    document.body.innerHTML = '<div class="halo-controls"></div>';
    let dismissed = 0;
    const ui = mountOffNudge(document, { onStart: async () => false, onDismiss: () => { dismissed += 1; } });
    const box = document.querySelector<HTMLElement>(".halo-controls .halo-nudge")!;
    expect(box.hidden).toBe(true);
    ui.show("off");
    expect(box.hidden).toBe(false);
    expect(box.textContent).toContain("Halo is off for this call.");
    box.querySelector<HTMLButtonElement>(".halo-primary")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(box.textContent).toContain("Click the Halo icon in the toolbar, then Start.");
    expect(box.querySelector<HTMLButtonElement>(".halo-primary")!.hidden).toBe(true);
    box.querySelectorAll<HTMLButtonElement>(".halo-btn")[1].click();
    expect(dismissed).toBe(1);
  });
});
