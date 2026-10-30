import { existsSync } from "node:fs";
import { chromium, expect, test } from "@playwright/test";

// PLAN Done (1), full form + (6) joined run: needs the real unpacked
// extension. hub_capture (the extension composition root) lands later in
// the W3 order, so until extension/.output exists this spec says so and
// skips instead of faking a pass.
const extPath = new URL("../../../extension/.output/chrome-mv3", import.meta.url).pathname;

test("harness loads the unpacked extension and the adapter reads every tile", async () => {
  test.skip(!existsSync(extPath),
    "no unpacked extension yet: hub_capture builds extension/.output later in the W3 order");
  const context = await chromium.launchPersistentContext("", {
    headless: false, // new headless Chromium loads extensions via --headless=new in Playwright
    args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:18778/index.html?halo_test=1");
  await expect(page.locator(".t")).toHaveCount(3);
  await context.close();
});
