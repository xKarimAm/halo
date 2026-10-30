# rig/fake_meet: STATE

## Goal
Implement rig/fake_meet per its PLAN.md; done ONLY when `npm --prefix rig/fake_meet test` passes and the contract tests for fake_meet pass.

## Key decisions
- Grown from `seed-fixture.html`: same DOM anchors (`data-participant-id`, `data-tile-media-id`, `.notranslate` name spans, self tile, pin button), now driven by a scripted fixture (`fixture.js`) instead of hard-coded tiles.
- Page builds DOM with `createElement`/`textContent` only, and the server sends CSP + `Require-Trusted-Types-For` headers, so `innerHTML`-style building fails here as on Meet (Done case 5).
- Painted ground truth is exposed as `window.__halo_truth` (tile rects + face boxes in tile-relative 0..1 coords) for the detector/overlay harness asserts; faces are painted on the tile canvas (skin disc + eyes) at the truth box.
- Modes: default video (canvas MediaStream into `<video>`, `object-fit: cover` at mismatched aspect) and `?mode=canvas-only` (no `<video>` at all, forces Frame mode). Join/leave/share/speaking are scripted helpers on `window.__halo_*`.

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
Done: Playwright self-checks green (5 passed, 2 skipped: extension-load and joined specs, both waiting on hub_capture/backend as titled). Local sandbox note: Playwright's webServer spawn hangs under the Muse sandbox user, so locally the server was started in-session first (`reuseExistingServer`); in CI the config's webServer runs normally. PR open for Karim to merge.

## Open questions
- Done case (1) full form (adapter reads tiles through the real extension) waits on `meet_adapter` + the unpacked extension build (hub_capture lane); the spec self-skips until `extension/.output` exists and says so in its title. Not blocking this lane's page/harness work.
