import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { chromium, expect, test } from "@playwright/test";

// PLAN Done (1), full form: the real unpacked extension on the Fake Meet
// page, served at a live-form URL (/meet/<code>), and the real meet_adapter
// reads every tile. Observed through the overlay's per-tile layers, which
// the content script renders from adapter.tiles() before any Start: no hub,
// no backend socket. Skips until `npm --prefix extension run build` ran.
const extPath = fileURLToPath(new URL("../../../extension/.output/chrome-mv3", import.meta.url));
const MEET_PORT = process.env.HALO_MEET_PORT || "18778";

test("real extension: adapter reads every tile on a /meet/<code> page", async () => {
  test.skip(!existsSync(extPath), "build the extension first: npm --prefix extension run build");
  const context = await chromium.launchPersistentContext(mkdtempSync(`${tmpdir()}/halo-ext-`), {
    channel: "chromium", // new headless: loads extensions (playwright.dev/docs/chrome-extensions)
    args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
  });
  try {
    // The content script matches https://meet.google.com/*: fulfil that
    // origin from the local Fake Meet server (nothing leaves the machine).
    await context.route("https://meet.google.com/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const res = await fetch(`http://127.0.0.1:${MEET_PORT}${path}`);
      await route.fulfill({
        status: res.status,
        headers: Object.fromEntries(res.headers),
        body: Buffer.from(await res.arrayBuffer()),
      });
    });
    const page = await context.newPage();
    await page.goto("https://meet.google.com/meet/abc-defg-hij");
    await expect(page.locator(".t")).toHaveCount(3);
    const layers = page.locator("[data-tile-id]");
    await expect(layers).toHaveCount(3, { timeout: 10000 }); // no layer for the panel row or fx decoy
    const names = {};
    for (const layer of await layers.all()) {
      names[await layer.getAttribute("data-tile-id")] = await layer.locator(".halo-name").textContent();
    }
    expect(names).toEqual({
      "spaces/x/devices/1": "Karim Amer", // not "visual_effects" (live 2026-10-31 bug)
      "spaces/x/devices/2": "ليلى حسن",
      "spaces/x/devices/3": "Sam Lee",
    });
  } finally {
    await context.close();
  }
});
