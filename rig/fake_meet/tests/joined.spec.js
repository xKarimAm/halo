import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { chromium, expect, test } from "@playwright/test";

// Joined thin run (verification gate 2), driven by rig.replayer.joined:
// the orchestrator starts the backend (HALO_FAKES=1) + fake engines, this
// spec loads the built extension, pairs and Starts on the Fake Meet page,
// and — once the orchestrator has replayed the fixture (replayed.flag) —
// asserts the point bubble lands on the speaker's tile. It writes
// started.flag after Start and result.json at the end; the orchestrator
// asserts the chain + latency + sqlite golden from its side.
const JOINED_DIR = process.env.HALO_JOINED_DIR;
const TILE_ID = process.env.HALO_SPEAKER_TILE || "spaces/x/devices/2";
const POINT_TEXT = process.env.HALO_POINT_TEXT || "Launch moves";
// The orchestrator hands over a copy of the built extension that talks to
// its own backend port (never the live 8765) and its Fake Meet port.
const MEET_PORT = process.env.HALO_MEET_PORT || "18778";

function extensionId(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const digest = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex");
  return digest.slice(0, 32).replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}

test("thin joined run: pair, Start, bubble on the right tile", async () => {
  test.skip(!JOINED_DIR, "driven by rig.replayer.joined (sets HALO_JOINED_DIR)");
  test.setTimeout(300_000);
  const extPath = process.env.HALO_EXT_PATH || "";
  expect(existsSync(extPath), "HALO_EXT_PATH missing (joined runner builds it)").toBe(true);
  const extId = extensionId(`${extPath}/manifest.json`);
  const context = await chromium.launchPersistentContext(
    mkdtempSync(`${tmpdir()}/halo-joined-profile-`), {
      channel: "chromium", // full Chromium: its headless mode loads extensions
      args: [
        `--disable-extensions-except=${extPath}`,
        `--load-extension=${extPath}`,
        "--no-sandbox", "--disable-dev-shm-usage",
      ],
    });
  try {
    // The content script matches meet.google.com; serve the Fake Meet
    // page there by fulfilling from the local Fake Meet server.
    await context.route("https://meet.google.com/**", async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname === "/" || !url.pathname.includes(".")
        ? "/index.html" : url.pathname;
      const res = await fetch(`http://127.0.0.1:${MEET_PORT}${path}`);
      await route.fulfill({
        status: res.status,
        contentType: res.headers.get("content-type") || "text/html",
        body: Buffer.from(await res.arrayBuffer()),
      });
    });

    const page = await context.newPage();
    await page.goto("https://meet.google.com/meet/abc-defg-hij?halo_test=1"); // live URL form
    await expect(page.locator(".t")).toHaveCount(3);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    await popup.fill("#pair-code", process.env.HALO_PAIR_CODE || "");
    await popup.click("#pair-btn");
    await expect(popup.locator("#pair-state")).toContainText("Paired", { timeout: 15000 });
    // The pairing code is single-use: the orchestrator's Mode A replays as
    // this same extension, so hand it the token the popup just stored.
    const token = await popup.evaluate(
      () => new Promise((resolve) => chrome.storage.local.get("halo.token", (items) => resolve(items["halo.token"]))));
    writeFileSync(`${JOINED_DIR}/token.json`, JSON.stringify({ token }));
    // Start is a user gesture on the Meet tab: opening the popup page above
    // made the popup the active tab, so bring the Meet page back forward or
    // the popup refuses Start (it must target the Meet tab for tabCapture).
    await page.bringToFront();
    await popup.click("#start-btn");
    writeFileSync(`${JOINED_DIR}/started.flag`, "started");

    // The hub must boot in the real offscreen document. Issue #49 blamed
    // Playwright, but the offscreen hub was throwing on chrome.storage
    // (offscreen documents get only chrome.runtime; fixed in #64). New
    // headless Chromium (channel "chromium") runs offscreen documents, so
    // no hub-as-tab fallback: a hub that never boots fails this spec.
    await expect.poll(() => popup.evaluate(
      () => chrome.storage.local.get("halo.hubBootedAt").then((items) => items["halo.hubBootedAt"] ?? null),
    ), { timeout: 10000, message: "offscreen hub never booted (halo.hubBootedAt unset)" }).not.toBeNull();
    const offscreen = await popup.evaluate(
      () => chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }).then((c) => c.length));
    expect(offscreen, "the hub runs in the offscreen document").toBe(1);

    // The orchestrator replays the fixture through the real backend now.
    const deadline = Date.now() + 240_000;
    while (!existsSync(`${JOINED_DIR}/replayed.flag`)) {
      if (Date.now() > deadline) throw new Error("orchestrator never replayed");
      await page.waitForTimeout(500);
    }

    const chip = page.locator(`[data-tile-id="${TILE_ID}"] [data-point-id]`).first();
    await expect(chip).toBeVisible({ timeout: 30000 });
    const text = await chip.textContent();
    expect(text).toContain(POINT_TEXT);

    // The bubble sits on the speaker's tile, not somewhere else on the page.
    const tileBox = await page.locator(`[data-participant-id="${TILE_ID}"]`).boundingBox();
    const chipBox = await chip.boundingBox();
    expect(tileBox && chipBox).toBeTruthy();
    const overlapX = Math.min(tileBox.x + tileBox.width, chipBox.x + chipBox.width)
      - Math.max(tileBox.x, chipBox.x);
    const overlapY = Math.min(tileBox.y + tileBox.height, chipBox.y + chipBox.height)
      - Math.max(tileBox.y, chipBox.y);
    expect(overlapX).toBeGreaterThan(0);
    expect(overlapY).toBeGreaterThan(0);

    writeFileSync(`${JOINED_DIR}/result.json`, JSON.stringify({
      ok: true, tileId: TILE_ID, text, seenAt: Date.now(),
    }));
  } finally {
    await context.close();
  }
});
