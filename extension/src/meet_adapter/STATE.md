# meet_adapter: STATE

Goal: Implement meet_adapter per its PLAN.md; done ONLY when `npm --prefix extension test` passes and the contract tests for meet_adapter pass.

## Key decisions

- `MeetAdapter` implemented in `meet_adapter.ts` over an injectable root (default `document`); pure DOM readers separated for tests. Keyed on `data-participant-id`, never class names.
- DOM conventions (documented in `conventions.md`, proposed to `rig/fake_meet` via issue since the rig has not landed): tile roots, name span, self marker, speaking attr, captions band. Real-Meet selector confirmation waits on the day-0 `meet-overlay` probe (outside repo); the module reads through one overridable convention table so probe results change constants, not logic.
- Dual delivery: in-tab direct (content-script wrapper reads the adapter) + Port leg via `createPortSync` (posts `tiles.snapshot` / `speaker.active` Port messages to the hub).
- Snapshot emission event-driven (MutationObserver) + 500 ms safety poll (overridable interval); `speaker.active` on highlight change only, no heartbeats.
- Canvas-only tiles snapshot with `video_w/h = 0`, `fit = "cover"` (schema requires the fields).
- Rig `fake_meet` not landed: L3 unrunnable; tests use happy-dom fixtures mirroring `seed-fixture.html` + golden-shape asserts.

## Task graph

1. [x] Worktree `.tmp/wt-meet_adapter` on branch `module/meet_adapter` from origin/main.
2. [ ] Tooling appends: `happy-dom` devDep + `resolveJsonModule` (same as setup_panel; re-applied on fresh main).
3. [ ] `meet_adapter.ts` + `port_sync.ts` with `meet_adapter.test.ts`, `port_sync.test.ts` (red then green).
4. [ ] `conventions.md` documenting the DOM contract for fake_meet/Meet.
5. [ ] `tsc` + full `npm test` green; raise `module:fake_meet` conventions issue; commit; push; PR.

## File map

- `extension/src/meet_adapter/STATE.md` — this file.
- `extension/src/meet_adapter/PLAN.md` — the contract (read-only).
- `extension/src/meet_adapter/meet_adapter.ts` — `MeetAdapter` implementation + convention table.
- `extension/src/meet_adapter/port_sync.ts` — Port-leg fan-out to the hub.
- `extension/src/meet_adapter/conventions.md` — DOM anchors this module reads (for fake_meet + probe).
- `extension/src/meet_adapter/*.test.ts` — Vitest (happy-dom) suites.
- Oracles (read-only): `contracts/tiles.snapshot.schema.json`, `contracts/golden/tiles.snapshot.json`, `contracts/golden/speaker.active.json`, `contracts/ext/meeting-adapter.ts`, `contracts/ext/port.ts`, `rig/fake_meet/seed-fixture.html`.

## Current step

Tasks 2-4 done: 12/12 Vitest green (run at real CI depth), `tsc --noEmit` clean. Next: commit, push, open PR. Cross-module issue filed: #8 (fake_meet conventions).

## Open questions

- (fake_meet, to file) Confirm/align DOM conventions: speaking toggle anchor, captions band marker, self-tile marker, canvas-only tile shape. Module reads via one convention table; fake page must implement the same anchors.
- (probe, Karim) Day-0 `meet-overlay` results (real Meet selectors) live outside the repo; porting constants to real Meet waits on them. Stop-rule applies: unreadable rects/highlight on real Meet = stop, back to Karim.
