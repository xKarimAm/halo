import { expect, test } from "@playwright/test";

// PLAN Done (1), page side: every scripted tile is readable through the
// DOM anchors the Meet Adapter contract relies on.
test("scripted tiles expose id, name and self tile via Meet anchors", async ({ page }) => {
  await page.goto("/index.html");
  const tiles = page.locator("[data-participant-id][data-tile-media-id], [data-participant-id].t");
  await expect(page.locator(".t")).toHaveCount(3);
  const names = await page.locator(".t .notranslate").allTextContents();
  expect(names).toContain("Karim Amer");
  expect(names).toContain("ليلى حسن");
  const self = page.locator('[data-participant-id="spaces/x/devices/1"]');
  await expect(self.locator('button[aria-label^="Pin Karim Amer"]')).toHaveCount(1);
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
  const self = page.locator('[data-participant-id="spaces/x/devices/1"]');
  await expect(self).toHaveClass(/speaking/, { timeout: 2000 });
  await expect(self).not.toHaveClass(/speaking/, { timeout: 3000 });
  await page.evaluate(() => window.__halo_join(
    { tile_id: "spaces/x/devices/4", media_id: "m4", name: "New Person", is_self: false, face: null }));
  await expect(page.locator(".t")).toHaveCount(4);
  await page.evaluate(() => window.__halo_leave("spaces/x/devices/4"));
  await expect(page.locator(".t")).toHaveCount(3);
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
