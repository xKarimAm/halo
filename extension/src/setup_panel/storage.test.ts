import { describe, expect, it } from "vitest";

import type { MeetingContext } from "../../../contracts/ext/gen/types";
import goldenContext from "../../../contracts/golden/meeting.context.json";
import { memorySetupStorage } from "./storage";

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
});
