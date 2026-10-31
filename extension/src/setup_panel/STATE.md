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

Live audio capture (popup half): Start comes from the active Meet tab (`start_target.ts` gate with refusal message), mints the tab stream id via tabCapture, and sends meeting_code + streamId through pendingStart; role prefill reads the hub's `halo/tileNames` (closes the prefill TODO — no Port change); mic section shows `halo.micState` (the one-time permission page was removed with #86: the mic now opens in the Meet tab, see below). StartResult refusal/warning display covered; async participants supported.

## Open questions

- (gateway) Confirm `POST /pair` response field (`{token}`?) and wrong-code HTTP status — filed as issue (see PR); coded to PLAN shape meanwhile.
- Done (live capture): Start → hub/capture handoff is pendingStart `{type, platform, meeting_code, self_name, streamId, tabId}` (tabId: the hub trusts `call.left` and mic frames from that tab only); role prefill reads the hub's `halo/tileNames` storage — no Port change needed.

## Popup redesign + mic in the Meet tab (2026-10-31)
- Popup is Karim's pick "Three steps" (Planning/ui/drafts/popup draft 2, Sage & Clay): Pair, About this meeting, Start; finished steps fold to one line (Change / Edit reopen). Styles in `entrypoints/popup/style.css`, icons in `src/public/icon/`. Every element id kept.
- No mic grant UI: the Meet content script opens the mic at Start under meet.google.com's permission (see hub_capture STATE). `#mic-state` is a status only.
- Button states (Karim, 2026-10-31): every button goes busy (spinner, disabled) then done or error; urgency toggle flashes "Saved". Start is idempotent: Starting, then Running (disabled) until the Meet tab leaves that call or the hub closes (`halo.runningMeeting` + `stillRunning`); popup-main also refuses a live repeat. One readiness line: Pair first / Open your Meet call / Ready for meeting / Running. Stop shows only when `onStop` is wired (after the Stop/leave PR).
