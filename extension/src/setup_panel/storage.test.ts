import { describe, expect, it } from "vitest";

import type { MeetingContext } from "../../../contracts/ext/gen/types";
import goldenContext from "../../../contracts/golden/meeting.context.json";
import {
  URGENCY_STYLE_KEY,
  chromeSetupStorage,
  memorySetupStorage,
  type StorageArea,
} from "./storage";

const golden = goldenContext.data as unknown as MeetingContext;

describe("memorySetupStorage", () => {
  it("starts empty", async () => {
    const storage = memorySetupStorage();
    expect(await storage.load()).toEqual({});
  });

  it("round-trips the token", async () => {
    const storage = memorySetupStorage();
    await storage.saveToken("tok-abc");
    expect(await storage.load()).toMatchObject({ token: "tok-abc" });
  });

  it("round-trips the context", async () => {
    const storage = memorySetupStorage();
    await storage.saveContext(golden);
    expect(await storage.load()).toMatchObject({ context: golden });
  });

  it("keeps token and context independently", async () => {
    const storage = memorySetupStorage({ token: "tok-abc" });
    await storage.saveContext(golden);
    expect(await storage.load()).toEqual({ token: "tok-abc", context: golden });
  });

  it("round-trips the urgency style alongside the rest", async () => {
    const storage = memorySetupStorage({ token: "tok-abc" });
    await storage.saveUrgencyStyle("symbols");
    expect(await storage.load()).toMatchObject({ token: "tok-abc", urgencyStyle: "symbols" });
    await storage.saveUrgencyStyle("words");
    expect(await storage.load()).toMatchObject({ urgencyStyle: "words" });
  });
});

function fakeArea(seed: Record<string, unknown> = {}): StorageArea & { written: Record<string, unknown>[] } {
  const store = { ...seed };
  const written: Record<string, unknown>[] = [];
  return {
    written,
    get: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, store[k]])),
    set: async (items: Record<string, unknown>) => {
      Object.assign(store, items);
      written.push(items);
    },
  };
}

describe("chromeSetupStorage urgency style", () => {
  it("uses the halo.urgencyStyle key the overlay reads", async () => {
    expect(URGENCY_STYLE_KEY).toBe("halo.urgencyStyle");
    const area = fakeArea();
    const storage = chromeSetupStorage(area);
    await storage.saveUrgencyStyle("symbols");
    expect(area.written).toEqual([{ [URGENCY_STYLE_KEY]: "symbols" }]);
    expect(await storage.load()).toMatchObject({ urgencyStyle: "symbols" });
  });

  it("ignores a stored value outside words|symbols", async () => {
    const storage = chromeSetupStorage(fakeArea({ [URGENCY_STYLE_KEY]: "bogus" }));
    expect(await storage.load()).not.toHaveProperty("urgencyStyle");
  });
});
