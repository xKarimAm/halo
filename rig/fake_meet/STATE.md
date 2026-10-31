# rig/fake_meet: STATE

## Goal
Implement rig/fake_meet per its PLAN.md; done ONLY when `npm --prefix rig/fake_meet test` passes and the contract tests for fake_meet pass.

## Key decisions
- Grown from `seed-fixture.html`: probe-faithful DOM (issue #47) — `data-participant-id`, `data-tile-media-id`, `span.notranslate` names, self tile with the `visual_effects` icon button, `[jsname="QgSmzd"]` speaking descendant lit with `sxlEM`, `[role="region"][aria-label="Captions"]` band — driven by a scripted fixture (`fixture.js`) instead of hard-coded tiles.
- Page builds DOM with `createElement`/`textContent` only, and the server sends CSP + `Require-Trusted-Types-For` headers, so `innerHTML`-style building fails here as on Meet (Done case 5).
- Painted ground truth is exposed as `window.__halo_truth` (tile rects + face boxes in tile-relative 0..1 coords) for the detector/overlay harness asserts; faces are painted on the tile canvas (skin disc + eyes) at the truth box.
- Modes: default video (canvas MediaStream into `<video>`, `object-fit: contain` per the probe) and `?mode=canvas-only` (no `<video>` at all, forces Frame mode). Join/leave/share/speaking/captions are scripted helpers on `window.__halo_*`; `?captions=0` hides the band.

## Task graph
1. `index.html` + `fixture.js` + `page.js` (scripted tiles, canvas streams, speaking/join/leave/share).
2. `server.js` (static + CSP/Trusted Types headers).
3. Playwright self-checks (anchors, canvas-only, speaking/join/leave, face truth, headers).
4. Extension-load + `test:joined` specs (skip until the unpacked extension exists; hub_capture lands later in the W3 order).

## File map
- `rig/fake_meet/index.html`: page shell (loads fixture.js, page.js).
- `rig/fake_meet/fixture.js`: scripted participants, faces, speaking timeline.
- `rig/fake_meet/page.js`: DOM build, canvas painting, `__halo_truth` / `__halo_*` helpers.
- `rig/fake_meet/server.js`: local server with Meet-like headers.
- `rig/fake_meet/tests/*.spec.js`: Playwright harness.

## Current step
Probe mirror (issue #47, closes #8) on branch `feature/fake-meet-probe-dom`: self/speaking/captions/contain ported; specs assert the probe anchors + captions script + joined-tile anchors. Awaiting Playwright run. Local sandbox note: Playwright's webServer spawn hangs under the Muse sandbox user, so locally the server is started in-session first (`reuseExistingServer`); in CI the config's webServer runs normally.

## Live-shape pass (branch `rig/strict-fakes`)
Served at any extensionless path (live `/meet/<code>`), assets absolute.
Self tile's Backgrounds button holds a `span.notranslate` icon span ahead
of the name (live 2026-10-31 name bug); camera-off tile = no `<video>`,
initial avatar (probe); level class `HX2H7` flips with `sxlEM` (probe);
panel-row + fx decoys (seed page); a text-bearing top-bar region (live
captions-off bug). `extension.spec.js` now loads the real built extension
headless (channel `chromium`) and asserts the adapter's names via the
overlay layers. `joined.spec.js` has no hub-as-tab fallback (issue #49:
the offscreen hub threw on chrome.storage, fixed in #64) and takes the
extension copy and Fake Meet port from the runner.

## Open questions
- (2-person live test, gate 4) If the probe revises any anchor, this page mirrors it in a follow-up.

## Open questions
- Done case (1) full form (adapter reads tiles through the real extension) waits on `meet_adapter` + the unpacked extension build (hub_capture lane); the spec self-skips until `extension/.output` exists and says so in its title. Not blocking this lane's page/harness work.
