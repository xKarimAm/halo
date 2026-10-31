import { expect, test } from "@playwright/test";

// PLAN Done (1), page side: every scripted tile is readable through the
// probe DOM anchors (issue #47) the adapter relies on.
test("scripted tiles expose id, name and self tile via Meet anchors", async ({ page }) => {
  await page.goto("/index.html");
  const tiles = page.locator("[data-participant-id][data-tile-media-id], [data-participant-id].t");
  await expect(page.locator(".t")).toHaveCount(3);
  const names = await page.locator(".t span.notranslate").allTextContents();
  expect(names).toContain("Karim Amer");
  expect(names).toContain("ليلى حسن");
  // Self tile: the only one with the Backgrounds-and-effects icon (probe).
  const self = page.locator('[data-participant-id="spaces/x/devices/1"]');
  await expect(self.locator('button[aria-label="Backgrounds and effects"] i')).toHaveText("visual_effects");
  await expect(page.locator('.t i')).toHaveCount(1);
  // Other tiles keep a pin button whose icon text must not read as a name.
  const other = page.locator('[data-participant-id="spaces/x/devices/2"]');
  await expect(other.locator('button[aria-label^="Pin"]')).toHaveCount(1);
  // Every tile carries the speaking-signal descendant (unlit by default).
  await expect(page.locator('.t [jsname="QgSmzd"]')).toHaveCount(3);
  await expect(page.locator('.t [jsname="QgSmzd"].sxlEM')).toHaveCount(0);
  const truth = await page.evaluate(() => window.__halo_truth);
  expect(truth.tiles.filter((t) => t.is_self)).toHaveLength(1);
});

// PLAN Done (2): canvas-only mode yields no <video>; page still attaches.
test("canvas-only mode has no video element", async ({ page }) => {
  await page.goto("/index.html?mode=canvas-only");
  await expect(page.locator("video")).toHaveCount(0);
  await expect(page.locator("canvas.tile")).toHaveCount(3);
});

// PLAN Done (3): speaking toggles on schedule; join/leave add/remove tiles.
test("speaking toggles and join/leave follow the script", async ({ page }) => {
  await page.goto("/index.html");
  const signal = page.locator('[data-participant-id="spaces/x/devices/1"] [jsname="QgSmzd"]');
  await expect(signal).toHaveClass(/sxlEM/, { timeout: 2000 });
  await expect(signal).not.toHaveClass(/sxlEM/, { timeout: 3000 });
  await page.evaluate(() => window.__halo_join(
    { tile_id: "spaces/x/devices/4", media_id: "m4", name: "New Person", is_self: false, face: null }));
  await expect(page.locator(".t")).toHaveCount(4);
  await page.evaluate(() => window.__halo_leave("spaces/x/devices/4"));
  await expect(page.locator(".t")).toHaveCount(3);
  // Joined tiles carry the same probe anchors (speaking descendant included).
  await page.evaluate(() => window.__halo_join(
    { tile_id: "spaces/x/devices/5", media_id: "m5", name: "Late Joiner", is_self: false, face: null }));
  await expect(page.locator('[data-participant-id="spaces/x/devices/5"] [jsname="QgSmzd"]')).toHaveCount(1);
  await expect(page.locator('[data-participant-id="spaces/x/devices/5"] > span.notranslate')).toHaveText("Late Joiner");
  await page.evaluate(() => window.__halo_leave("spaces/x/devices/5"));
  await expect(page.locator(".t")).toHaveCount(3);
});

// Captions band: the probe's region anchor with speaker rows (the adapter's
// floor); scriptable text via __halo_captions, ?captions=0 hides the band.
test("captions band exposes the region anchor and follows the script", async ({ page }) => {
  await page.goto("/index.html");
  const band = page.locator('[role="region"][aria-label="Captions"]');
  await expect(band).toBeVisible();
  await expect(band).toContainText("Karim Amer");
  await page.evaluate(() => window.__halo_captions("Omar: تمام"));
  await expect(band).toContainText("Omar: تمام");
  const box = await band.boundingBox();
  expect(box.width).toBeGreaterThan(700); // full-width band at the bottom
  await page.goto("/index.html?captions=0");
  await expect(page.locator('[role="region"][aria-label="Captions"]')).toHaveCount(0);
});

// PLAN Done (4): painted faces carry ground-truth boxes (IoU spec consumes them).
test("painted faces carry ground-truth boxes", async ({ page }) => {
  await page.goto("/index.html?mode=canvas-only");
  const truth = await page.evaluate(() => window.__halo_truth);
  expect(truth.faces).toHaveLength(2);
  for (const f of truth.faces) {
    expect(f.box).toHaveLength(4);
    for (const v of f.box) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1);
  }
});

// PLAN Done (5): CSP + Trusted Types headers are served.
test("page serves CSP and Trusted Types headers", async ({ page }) => {
  const res = await page.goto("/index.html");
  const headers = res.headers();
  expect(headers["content-security-policy"]).toContain("default-src");
  expect(headers["require-trusted-types-for"]).toContain("script");
});
