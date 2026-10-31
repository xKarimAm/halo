# overlay: STATE

## Goal
Implement extension/src/overlay per its PLAN.md (Frame mode first); done ONLY when `npm --prefix extension test` passes and the contract tests for overlay pass.

## Key decisions
- Tokens only from `docs/ui/overlay-mix-b.html` (kind colours sky/lilac/mint/peach, solid disc + black glyph + 1.5px black ring, smoked glass); geometry/timing from `OVERLAY-UX.md`. Urgency mark on bubbles per DECISIONS (draft-2 word tabs default, draft-1 seals via `halo.urgencyStyle`); the popover header still shows the word "Urgent" as plain text.
- Frame mode is the shipped path in this PR (W3 order); Face-mode projection math (tile rect + video size + object-fit, self-tile x-flip) is implemented and unit-tested, and activates per-tile when `faces.update` arrives — the detector itself is the next module.
- Core is a DOM-free store + layout engine; the renderer takes an injected minimal document so Vitest tests element identity (one chip per point id) without new dependencies. All DOM text goes through `textContent` only (Trusted Types).
- No code dependency on hub_capture/meet_adapter/face_detector (feeds are injected), so this PR builds from main; L3 DOM ±4 px on the Fake Meet page runs once those lanes merge.

## Task graph
1. Tokens (Mix B) + kind model.
2. Store (points/tags/speaker.mapped/system.status/notes.ready, dedupe, user-tag wins, expiry/ageing).
3. Layout (Frame pin, Face projection, +N fold, captions floor).
4. Renderer (one chip per point id, thinking sweep, badge/status/toast models, popover, consent copy).
5. Vitest Done cases (1)-(9), Frame-mode first.

## File map
- `extension/src/overlay/tokens.ts`: Mix B colours/glass/icon CSS.
- `extension/src/overlay/overlay.ts`: store + layout + renderer + consent/badge models.
- `extension/src/overlay/overlay.test.ts`: Done-case tests with a fake DOM.
- `extension/src/overlay/index.ts`: Meet-page boot for the hub content wrapper.

## Current step
Face-mode wiring (verification gate 5): viewer Face|Frame toggle (`halo.overlayMode`, default Face, live `storage.onChanged` switch mirroring the urgency style); `boot()` returns `{ overlay, onFacesUpdate }` so the hub wiring feeds faces.update through one seam; face-mode name/stack offsets are tile-local (the layer sits at the tile origin — previously double-counted on offset tiles); layers carry `data-mode` + `data-face-box` for the L3 IoU assert. 30 overlay tests green (8 new), `tsc --noEmit` clean. meet.content.ts call-site sync included (2 lines, flagged for hub_capture).

## Open questions
- Urgency-mark look: decided by Karim (both drafts; words default) — implemented here; setup-panel toggle is a separate PR in that lane.
- L3 ±4 px asserts wait on hub_capture + meet_adapter merging (both have open PRs); unit geometry here is the same math the L3 spec will assert.
