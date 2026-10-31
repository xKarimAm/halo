# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: joined.spec.js >> thin joined run: pair, Start, bubble on the right tile
- Location: tests\joined.spec.js:23:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('#pair-state')
Expected substring: "Paired"
Received string:    "Not paired"
Timeout: 15000ms

Call log:
  - Expect "toContainText" locator('#pair-state') with timeout 15000ms
  - waiting for locator('#pair-state')
    33 × locator resolved to <p id="pair-state">Not paired</p>
       - unexpected value "Not paired"

```

```yaml
- paragraph: Not paired
```

# Test source

```ts
  1   | import { createHash } from "node:crypto";
  2   | import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
  3   | import { tmpdir } from "node:os";
  4   | import { chromium, expect, test } from "@playwright/test";
  5   | 
  6   | // Joined thin run (verification gate 2), driven by rig.replayer.joined:
  7   | // the orchestrator starts the backend (HALO_FAKES=1) + fake engines, this
  8   | // spec loads the built extension, pairs and Starts on the Fake Meet page,
  9   | // and — once the orchestrator has replayed the fixture (replayed.flag) —
  10  | // asserts the point bubble lands on the speaker's tile. It writes
  11  | // started.flag after Start and result.json at the end; the orchestrator
  12  | // asserts the chain + latency + sqlite golden from its side.
  13  | const JOINED_DIR = process.env.HALO_JOINED_DIR;
  14  | const TILE_ID = process.env.HALO_SPEAKER_TILE || "spaces/x/devices/2";
  15  | const POINT_TEXT = process.env.HALO_POINT_TEXT || "Launch moves";
  16  | 
  17  | function extensionId(manifestPath) {
  18  |   const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  19  |   const digest = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex");
  20  |   return digest.slice(0, 32).replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
  21  | }
  22  | 
  23  | test("thin joined run: pair, Start, bubble on the right tile", async () => {
  24  |   test.skip(!JOINED_DIR, "driven by rig.replayer.joined (sets HALO_JOINED_DIR)");
  25  |   test.setTimeout(300_000);
  26  |   const extPath = new URL("../../../extension/.output/chrome-mv3", import.meta.url).pathname
  27  |     .replace(/^\/([A-Za-z]:)/, "$1");
  28  |   expect(existsSync(extPath), "extension .output missing (joined runner builds it)").toBe(true);
  29  |   const extId = extensionId(`${extPath}/manifest.json`);
  30  |   const context = await chromium.launchPersistentContext(
  31  |     mkdtempSync(`${tmpdir()}/halo-joined-profile-`), {
  32  |       channel: "chromium", // full Chromium: its headless mode loads extensions
  33  |       args: [
  34  |         `--disable-extensions-except=${extPath}`,
  35  |         `--load-extension=${extPath}`,
  36  |         "--no-sandbox", "--disable-dev-shm-usage",
  37  |       ],
  38  |     });
  39  |   try {
  40  |     // The content script matches meet.google.com; serve the Fake Meet
  41  |     // page there by fulfilling from the local Fake Meet server.
  42  |     await context.route("https://meet.google.com/**", async (route) => {
  43  |       const url = new URL(route.request().url());
  44  |       const path = url.pathname === "/" || !url.pathname.includes(".")
  45  |         ? "/index.html" : url.pathname;
  46  |       const res = await fetch(`http://127.0.0.1:18778${path}`);
  47  |       await route.fulfill({
  48  |         status: res.status,
  49  |         contentType: res.headers.get("content-type") || "text/html",
  50  |         body: Buffer.from(await res.arrayBuffer()),
  51  |       });
  52  |     });
  53  | 
  54  |     const page = await context.newPage();
  55  |     await page.goto("https://meet.google.com/joined-room?halo_test=1");
  56  |     await expect(page.locator(".t")).toHaveCount(3);
  57  | 
  58  |     const popup = await context.newPage();
  59  |     await popup.goto(`chrome-extension://${extId}/popup.html`);
  60  |     await popup.fill("#pair-code", process.env.HALO_PAIR_CODE || "");
  61  |     await popup.click("#pair-btn");
> 62  |     await expect(popup.locator("#pair-state")).toContainText("Paired", { timeout: 15000 });
      |                                                ^ Error: expect(locator).toContainText(expected) failed
  63  |     // The pairing code is single-use: the orchestrator's Mode A replays as
  64  |     // this same extension, so hand it the token the popup just stored.
  65  |     const token = await popup.evaluate(
  66  |       () => new Promise((resolve) => chrome.storage.local.get("halo.token", (items) => resolve(items["halo.token"]))));
  67  |     writeFileSync(`${JOINED_DIR}/token.json`, JSON.stringify({ token }));
  68  |     await popup.click("#start-btn");
  69  |     writeFileSync(`${JOINED_DIR}/started.flag`, "started");
  70  | 
  71  |     // Rig stub (see PR body): chrome.offscreen documents are created but
  72  |     // never execute under Playwright's Chromium (headless or headed in
  73  |     // this sandbox; hubBootedAt stays unset). If the hub page has not
  74  |     // booted via the offscreen document, host the same hub page as a tab
  75  |     // so the identical hub code runs. Real Chrome executes offscreen
  76  |     // documents normally; nothing in the extension depends on this.
  77  |     let bootedAt = null;
  78  |     for (let i = 0; i < 10 && !bootedAt; i += 1) {
  79  |       bootedAt = await popup.evaluate(
  80  |         () => chrome.storage.local.get("halo.hubBootedAt").then((items) => items["halo.hubBootedAt"] ?? null),
  81  |       ).catch(() => null);
  82  |       if (!bootedAt) await page.waitForTimeout(500);
  83  |     }
  84  |     if (!bootedAt) {
  85  |       const hubPage = await context.newPage();
  86  |       await hubPage.goto(`chrome-extension://${extId}/offscreen.html`);
  87  |     }
  88  | 
  89  |     // The orchestrator replays the fixture through the real backend now.
  90  |     const deadline = Date.now() + 240_000;
  91  |     while (!existsSync(`${JOINED_DIR}/replayed.flag`)) {
  92  |       if (Date.now() > deadline) throw new Error("orchestrator never replayed");
  93  |       await page.waitForTimeout(500);
  94  |     }
  95  | 
  96  |     const chip = page.locator(`[data-tile-id="${TILE_ID}"] [data-point-id]`).first();
  97  |     await expect(chip).toBeVisible({ timeout: 30000 });
  98  |     const text = await chip.textContent();
  99  |     expect(text).toContain(POINT_TEXT);
  100 | 
  101 |     // The bubble sits on the speaker's tile, not somewhere else on the page.
  102 |     const tileBox = await page.locator(`[data-participant-id="${TILE_ID}"]`).boundingBox();
  103 |     const chipBox = await chip.boundingBox();
  104 |     expect(tileBox && chipBox).toBeTruthy();
  105 |     const overlapX = Math.min(tileBox.x + tileBox.width, chipBox.x + chipBox.width)
  106 |       - Math.max(tileBox.x, chipBox.x);
  107 |     const overlapY = Math.min(tileBox.y + tileBox.height, chipBox.y + chipBox.height)
  108 |       - Math.max(tileBox.y, chipBox.y);
  109 |     expect(overlapX).toBeGreaterThan(0);
  110 |     expect(overlapY).toBeGreaterThan(0);
  111 | 
  112 |     writeFileSync(`${JOINED_DIR}/result.json`, JSON.stringify({
  113 |       ok: true, tileId: TILE_ID, text, seenAt: Date.now(),
  114 |     }));
  115 |   } finally {
  116 |     await context.close();
  117 |   }
  118 | });
  119 | 
```