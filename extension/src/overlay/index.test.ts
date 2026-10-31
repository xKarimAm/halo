import { afterEach, describe, expect, it, vi } from "vitest";
import { Overlay, FakeClock } from "./overlay";
import { URGENCY_STYLE_KEY, readUrgencyStyle, watchUrgencyStyle } from "./index";

// Fake chrome.storage.local + onChanged on globalThis (the entry reads
// chrome structurally, so tests inject it without ambient types).
type Listener = (changes: Record<string, { newValue?: unknown }>) => void;
function fakeChrome(stored: unknown, hooks: { listeners: Listener[] }) {
  return {
    storage: {
      local: { get: async (_keys: string[]) => ({ [URGENCY_STYLE_KEY]: stored }) },
      onChanged: { addListener: (fn: Listener) => { hooks.listeners.push(fn); } },
    },
  };
}

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
  vi.unstubAllGlobals();
});

describe("urgency style storage", () => {
  it("defaults to words when nothing is stored", async () => {
    const hooks = { listeners: [] as Listener[] };
    (globalThis as unknown as { chrome: unknown }).chrome = fakeChrome(undefined, hooks);
    await expect(readUrgencyStyle()).resolves.toBe("words");
  });

  it("reads symbols and ignores garbage", async () => {
    const hooks = { listeners: [] as Listener[] };
    (globalThis as unknown as { chrome: unknown }).chrome = fakeChrome("symbols", hooks);
    await expect(readUrgencyStyle()).resolves.toBe("symbols");
    (globalThis as unknown as { chrome: unknown }).chrome = fakeChrome("bogus", hooks);
    await expect(readUrgencyStyle()).resolves.toBe("words");
  });

  it("defaults to words with no chrome at all", async () => {
    await expect(readUrgencyStyle()).resolves.toBe("words");
  });

  it("watch applies the stored style then switches live on storage.onChanged", async () => {
    const hooks = { listeners: [] as Listener[] };
    (globalThis as unknown as { chrome: unknown }).chrome = fakeChrome("symbols", hooks);
    const overlay = new Overlay(new FakeClock());
    const rerender = vi.fn();
    watchUrgencyStyle(overlay, rerender);
    await Promise.resolve();
    await Promise.resolve();
    expect(overlay.urgencyStyle).toBe("symbols");
    expect(rerender).toHaveBeenCalled();
    expect(hooks.listeners).toHaveLength(1);
    rerender.mockClear();
    hooks.listeners[0]({ [URGENCY_STYLE_KEY]: { newValue: "words" } });
    expect(overlay.urgencyStyle).toBe("words");
    expect(rerender).toHaveBeenCalledTimes(1);
    // unrelated keys do not re-render
    hooks.listeners[0]({ "halo.other": { newValue: 1 } });
    expect(rerender).toHaveBeenCalledTimes(1);
  });
});
