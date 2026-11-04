import { describe, expect, it } from "vitest";
import { welcomeOnInstall } from "./welcome";

// Karim 2026-11-04: the welcome page shows once, on install; never on an update.
describe("welcome page", () => {
  const run = (reason: string) => {
    const opened: string[] = [];
    welcomeOnInstall({ reason }, { create: (o) => { opened.push(o.url); } }, (p) => `chrome-extension://x${p}`);
    return opened;
  };
  it("opens on a fresh install", () => {
    expect(run("install")).toEqual(["chrome-extension://x/welcome.html"]);
  });
  it("never opens on an update or a Chrome update", () => {
    expect(run("update")).toEqual([]);
    expect(run("chrome_update")).toEqual([]);
  });
});
