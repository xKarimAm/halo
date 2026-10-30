# overlay: STATE

## Goal
Implement extension/src/overlay per its PLAN.md (Frame mode first); done ONLY when `npm --prefix extension test` passes and the contract tests for overlay pass.

## Key decisions
- Tokens only from `docs/ui/overlay-mix-b.html` (kind colours sky/lilac/mint/peach, solid disc + black glyph + 1.5px black ring, smoked glass); geometry/timing from `OVERLAY-UX.md`. No urgency mark on bubbles (draft not picked); the popover header shows the word "Urgent" as plain text.
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
Review fix pushed: captions floor implemented — chips fold into +N so a bubble's bottom never goes below `captions_rect`'s top edge (null = no floor, normal cap), fit from summed chip heights (28 px + 6 px gap). 11 Vitest cases green, `tsc --noEmit` clean. Then rebased on main. Face-mode projection is unit-tested and activates when face_detector lands; L3 ±4 px runs once hub_capture/meet_adapter merge.

## Open questions
- Urgency-mark look: open draft item for Karim (not blocking; plain-text "Urgent" in the popover until picked, per PLAN).
- L3 ±4 px asserts wait on hub_capture + meet_adapter merging (both have open PRs); unit geometry here is the same math the L3 spec will assert.
