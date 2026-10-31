import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// A port nothing listens on: bind an ephemeral one, then free it.
function closedPort() {
  return new Promise((resolve) => {
    const srv = createServer().listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// The build dials the user's LIVE backend (127.0.0.1:8765) once Start boots
// the hub. This spec needs no backend, so it loads a copy pointed at a
// closed port: the rig never touches 8765 (same rule as rig/replayer/joined.py).
async function offlineCopy(src) {
  const dst = mkdtempSync(`${tmpdir()}/halo-leave-ext-`);
  cpSync(src, dst, { recursive: true });
  const dead = `127.0.0.1:${await closedPort()}`;
  for (const rel of readdirSync(dst, { recursive: true })) {
    if (!/\.(js|json|html)$/.test(rel)) continue;
    const file = join(dst, rel);
    const text = readFileSync(file, "utf-8");
    if (text.includes("8765")) writeFileSync(file, text.replaceAll("127.0.0.1:8765", dead));
    if (readFileSync(file, "utf-8").includes("8765")) throw new Error(`copy still names 8765: ${rel}`);
  }
  return dst;
}

test("leaving the call or pressing Stop ends the meeting", async () => {
  test.skip(!existsSync(extPath), "no unpacked extension: run npm --prefix extension run build");
  test.setTimeout(60_000);
  const extId = extensionId(`${extPath}/manifest.json`);
  const ext = await offlineCopy(extPath);
  const context = await chromium.launchPersistentContext(
    mkdtempSync(`${tmpdir()}/halo-leave-profile-`), {
      channel: "chromium", // full Chromium: its headless mode loads extensions
      args: [
        `--disable-extensions-except=${ext}`,
        `--load-extension=${ext}`,
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

    // 2. Start again, then the popup's Stop button. Reopen the popup first,
    // as a user does (it closes on any click into Meet): the open one still
    // shows Start as "Running" from the first meeting.
    await popup.reload();
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
