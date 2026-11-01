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
Urgency mark (DECISIONS: words default + symbols, viewer setting): chip carries a draft-2 word tab (localised EN/AR) or a draft-1 seal at 14px (~25% under the 19px draft); style from `halo.urgencyStyle` with live `storage.onChanged` switch; 21 overlay tests green, `tsc --noEmit` clean. Face-mode projection is unit-tested and activates when face_detector lands; L3 ±4 px runs once hub_capture/meet_adapter merge.

Issue #73: `mountControls` (index.ts) adds the badge (top-left, `Halo` / `Halo · hidden`), a "Consent notice" button opening the editable consent dialog ("Copy notice" copies the textarea via `copyConsentNotice`, confirms in a status line), and the notes-ready toast (link to `http://127.0.0.1:8765` + `notes.ready.url`, new tab, dismissible). Tests: `controls.test.ts` (happy-dom). 2026-11-01: the three missing live pieces are wired in `index.ts` (tests in `controls.test.ts`): `mountPopover` (bubble click opens kind, speaker, text, original quote with its script direction; Esc, outside click or a second click closes; focus returns), `bindHideKey` (Alt+H in capture phase by physical key, so an Arabic layout works; Ctrl+Alt+H passes to Meet), and a points-language `<select>` beside the badge (posts Port `set_viewer_lang`, saves `viewer_lang` into the setup panel's `halo.context` so the next Start keeps it). Review fixes the same day: bare Alt+H only (Shift/Meta pass through), a held key toggles once, focus moves into the card and only Esc or a second bubble click returns it, the card follows its point after every render (closes when hidden or expired, refreshes on a correction), flips above the bubble near the screen bottom, OVERLAY-UX 6 size/radius/tint/180 ms entry, and `.halo-chip *{pointer-events:none}` so a re-render between mousedown and mouseup cannot swallow a bubble click. Known gap: a language change before Start only lands in storage (the hub has no context yet), and the popup's Save rebuilds `halo.context` from its own form. Not built yet: the meeting timestamp and correction history in the card, the rest of the badge menu (points per face, Recorder switch, REC dot), the popover's "Open in notes" link and "shown N s after pause", AR UI labels, and storing hidden state across reloads.

## Open questions
- Urgency-mark look: decided by Karim (both drafts; words default) — implemented here; setup-panel toggle is a separate PR in that lane.
- L3 ±4 px asserts wait on hub_capture + meet_adapter merging (both have open PRs); unit geometry here is the same math the L3 spec will assert.
