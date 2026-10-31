import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake chrome for the worker entrypoint (hub_capture owns it).
type Listener = (msg: Record<string, unknown>, sender: unknown, reply: (r: unknown) => void) => boolean;

function fakeChrome(hasDocument: boolean) {
  const store: Record<string, unknown> = {};
  const listeners: Listener[] = [];
  const sent: Record<string, unknown>[] = [];
  const chrome = {
    storage: {
      local: {
        get: async (keys: string[]) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])),
        set: async (items: Record<string, unknown>) => { Object.assign(store, items); },
        remove: async (key: string) => { delete store[key]; },
      },
    },
    runtime: {
      onMessage: { addListener: (fn: Listener) => listeners.push(fn) },
      // A hub still booting has no listener: Chrome rejects the send.
      sendMessage: vi.fn(async (msg: Record<string, unknown>) => {
        sent.push(msg);
        throw new Error("Could not establish connection. Receiving end does not exist.");
      }),
      getManifest: () => ({ version: "0.1.0" }),
      getContexts: async () => (hasDocument ? [{ contextType: "OFFSCREEN_DOCUMENT" }] : []),
    },
    offscreen: {
      createDocument: vi.fn(async () => {}),
    },
  };
  const dispatch = (msg: Record<string, unknown>) =>
    new Promise<unknown>((resolve) => {
      for (const fn of listeners) if (!fn(msg, {}, resolve)) resolve(undefined);
    });
  return { chrome, store, sent, dispatch };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const start = { type: "halo/hub.start", platform: "meet", meeting_code: "abc-defg-hij", self_name: "", streamId: "s1" };

async function bootWorker(hasDocument: boolean) {
  const fake = fakeChrome(hasDocument);
  (globalThis as { chrome?: unknown }).chrome = fake.chrome;
  vi.resetModules();
  const mod = await import("../entrypoints/background");
  (mod.default as unknown as { main(): void }).main();
  return fake;
}

describe("background worker Start handoff", () => {
  beforeEach(() => { delete (globalThis as { chrome?: unknown }).chrome; });

  it("hands the saved meeting.context over with the Start (the popup Port reached no hub)", async () => {
    const fake = await bootWorker(false);
    fake.store["halo.token"] = "tok";
    fake.store["halo.context"] = { subject: "Launch", agenda: [], roles: [], viewer_lang: "en" };
    await fake.dispatch(start);
    await flush();
    expect(fake.chrome.offscreen.createDocument).toHaveBeenCalledTimes(1);
    const handoff = (await fake.dispatch({ type: "halo/offscreen.ready" })) as Record<string, unknown>;
    expect(handoff).toMatchObject({ start, token: "tok", context: { subject: "Launch" } });
    expect(fake.store["halo.pendingStart"]).toBeUndefined(); // consumed once
  });

  it("a Start while the hub document is still booting is not lost: nudge, never consume", async () => {
    const fake = await bootWorker(true); // document exists, its listeners do not yet
    await fake.dispatch(start);
    await flush();
    expect(fake.sent).toEqual([{ type: "halo/offscreen.pull" }]);
    expect(fake.store["halo.pendingStart"]).toBeDefined(); // still there for the hub's own pull
    const handoff = (await fake.dispatch({ type: "halo/offscreen.ready" })) as Record<string, unknown>;
    expect(handoff).toMatchObject({ start });
  });
});
