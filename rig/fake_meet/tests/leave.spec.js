import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { chromium, expect, test } from "@playwright/test";

// Issue #72: the meeting ends when the user leaves the call (tab stays open)
// or presses Stop in the popup. No backend: the hub's own running flag
// (halo.meetingRunning, written by Hub.start/stop) is the observable.
const extPath = new URL("../../../extension/.output/chrome-mv3", import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, "$1");

function extensionId(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const digest = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex");
  return digest.slice(0, 32).replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}

test("leaving the call or pressing Stop ends the meeting", async () => {
  test.skip(!existsSync(extPath), "no unpacked extension: run npm --prefix extension run build");
  test.setTimeout(60_000);
  const extId = extensionId(`${extPath}/manifest.json`);
  const context = await chromium.launchPersistentContext(
    mkdtempSync(`${tmpdir()}/halo-leave-profile-`), {
      channel: "chromium", // full Chromium: its headless mode loads extensions
      args: [
        `--disable-extensions-except=${extPath}`,
        `--load-extension=${extPath}`,
        "--no-sandbox", "--disable-dev-shm-usage",
      ],
    });
  try {
    await context.route("https://meet.google.com/**", async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname === "/" || !url.pathname.includes(".") ? "/index.html" : url.pathname;
      const res = await fetch(`http://127.0.0.1:18778${path}`);
      await route.fulfill({
        status: res.status,
        contentType: res.headers.get("content-type") || "text/html",
        body: Buffer.from(await res.arrayBuffer()),
      });
    });
    const page = await context.newPage();
    await page.goto("https://meet.google.com/abc-defg-hij?halo_test=1");
    await expect(page.locator(".t")).toHaveCount(3);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    const running = () => popup.evaluate(
      () => chrome.storage.local.get("halo.meetingRunning").then((i) => i["halo.meetingRunning"] ?? null));
    const start = async () => {
      await page.bringToFront(); // Start must target the Meet tab
      await popup.click("#start-btn");
    };

    await start();
    // Same rig stub as joined.spec.js: offscreen documents do not execute
    // under Playwright's Chromium, so host the identical hub page as a tab.
    await page.waitForTimeout(1500);
    const booted = await popup.evaluate(
      () => chrome.storage.local.get("halo.hubBootedAt").then((i) => i["halo.hubBootedAt"] ?? null));
    if (!booted) await (await context.newPage()).goto(`chrome-extension://${extId}/offscreen.html`);
    await expect.poll(running, { timeout: 15000 }).toBe(true);

    // 1. Leave the call: every tile goes, the tab stays open.
    await page.evaluate(() => {
      for (const t of [...window.__halo_truth.tiles]) window.__halo_leave(t.tile_id);
    });
    await expect(page.locator(".t")).toHaveCount(0);
    await expect.poll(running, { timeout: 15000 }).toBe(false);

    // 2. Start again, then the popup's Stop button.
    await start();
    await expect.poll(running, { timeout: 15000 }).toBe(true);
    await popup.reload();
    await expect(popup.locator("#stop-btn")).toBeVisible();
    await popup.click("#stop-btn");
    await expect.poll(running, { timeout: 15000 }).toBe(false);
    await expect(popup.locator("#stop-btn")).toBeHidden();
  } finally {
    await context.close();
  }
});
