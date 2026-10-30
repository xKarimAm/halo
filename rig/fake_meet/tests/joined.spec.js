import { expect, test } from "@playwright/test";

// PLAN Done (6) / Nov 1 thin milestone: real extension + Fake Meet, with
// the real backend run separately (HALO_FAKES=1 uv run halo). Driven by
// `npm --prefix rig/fake_meet run test:joined`; skips unless HALO_JOINED=1
// and the unpacked extension exists, so the default suite stays offline.
test("thin joined run: bubble lands on the right tile", async ({ page }) => {
  test.skip(process.env.HALO_JOINED !== "1",
    "joined run needs the backend up separately: HALO_FAKES=1 uv run halo, then HALO_JOINED=1");
  await page.goto("/index.html?halo_test=1");
  await expect(page.locator(".t")).toHaveCount(3);
  // The overlay bubble assert lands with the overlay module (W3 order:
  // rig -> hub_capture -> overlay Frame mode -> face_detector).
});
