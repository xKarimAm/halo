# setup_panel: STATE

Goal: Implement setup_panel per its PLAN.md; done ONLY when `npm --prefix extension test` passes and the contract tests for setup_panel pass.

## Key decisions

- Popup owns pairing UI (frontend side), meeting form, Save (Port `meeting.context`), and the Start click. No consent UI anywhere in this lane (Overlay owns it).
- `POST http://127.0.0.1:8765/pair {code}` → `{token}`; token in `chrome.storage.local` under `halo.token`. Gateway `POST /pair` is not built yet (W1), so `pairWithCode` codes against the PLAN shape and is tested with mocked fetch. Open question to Gateway: confirm response field + wrong-code status (issue to file).
- Start-click → hub handoff is hub_capture's API (not yet built). Popup takes an injected `onStart`; the entry wrapper supplies the real one once hub_capture defines it (issue to file). Tested with a spy: one call per click, none without.
- Participant-name prefill: pure `mergeTileNames` (keeps free-text rows, adds new tile names by exact match, never deletes). How tile names reach the panel (no hub→panel Port message exists) is an open question to hub_capture/contracts (issue to file); the popup takes an injected `listParticipants` defaulting to `[]`.
- Rig `fake_meet` has not landed (only PLAN.md + seed HTML), so L3 is not runnable; tests run against the `meeting.context` golden sample + mocked Port/fetch/storage.

## Task graph

1. [x] Worktree `.tmp/wt-setup_panel` on branch `module/setup_panel` from main tip.
2. [ ] `context.ts` + `context.test.ts` (agenda split, empty-role omit, project omit, golden-shape match).
3. [ ] `pairing.ts` + `pairing.test.ts` (ok stores token; wrong code errors, nothing stored).
4. [ ] `storage.ts` + `storage.test.ts` (save/restore token + context).
5. [ ] `popup.ts` + `popup.test.ts` (Save posts one Port message; Start calls onStart once; no click nothing; no consent controls; reopen restores).
6. [ ] Entry wrapper `entrypoints/popup/` (thin boot + chrome-backed deps).
7. [ ] `tsc --noEmit` + `npm --prefix extension test` green; contract-shape check vs golden.
8. [ ] Raise gateway + hub_capture issues; commit; push; open PR.

## File map

- `extension/src/setup_panel/STATE.md` — this file.
- `extension/src/setup_panel/PLAN.md` — the contract (read-only).
- `extension/src/setup_panel/context.ts` — form → `MeetingContext` pure logic.
- `extension/src/setup_panel/pairing.ts` — `POST /pair` exchange.
- `extension/src/setup_panel/storage.ts` — `chrome.storage.local` wrapper + memory fake.
- `extension/src/setup_panel/popup.ts` — popup wiring (render, restore, Save, Start).
- `extension/src/setup_panel/chrome-api.d.ts` — minimal chrome types used by this lane.
- `extension/src/setup_panel/*.test.ts` — Vitest suites (popup suite runs under happy-dom).
- `extension/src/entrypoints/popup/` — thin WXT wrapper booting this module.
- `contracts/meeting.context.schema.json`, `contracts/golden/meeting.context.json` — oracle (read-only).
- `contracts/ext/port.ts`, `contracts/ext/gen/types.ts` — Port + `MeetingContext` types (read-only).

## Current step

Urgency toggle (DECISIONS: viewer setting `halo.urgencyStyle`): Words|Symbols radio pair in a viewer-prefs section, restored on open, written immediately so the overlay switches live via storage.onChanged. `saveUrgencyStyle` added to both chrome and memory storage. 83/83 extension tests green (5 new), `tsc --noEmit` clean. Next: commit, push, open PR (branch feature/setup-panel-urgency-toggle; module/setup_panel already merged).

## Open questions

- (gateway) Confirm `POST /pair` response field (`{token}`?) and wrong-code HTTP status — filed as issue (see PR); coded to PLAN shape meanwhile.
- (hub_capture) Define the Start-click → hub/capture handoff the popup must invoke — filed as issue (see PR); popup takes injected `onStart` meanwhile.
- (hub_capture/contracts) How do adapter tile names reach the panel for role prefill (no hub→panel Port message exists)? May need a Port addition (`contract-change`, waits for Karim); popup takes injected `listParticipants` meanwhile.
