# meet_adapter: STATE

Goal: Implement meet_adapter per its PLAN.md; done ONLY when `npm --prefix extension test` passes and the contract tests for meet_adapter pass.

## Key decisions

- `MeetAdapter` implemented in `meet_adapter.ts` over an injectable root (default `document`); pure DOM readers separated for tests. Keyed on `data-participant-id`, never class names.
- DOM conventions (documented in `conventions.md`, mirrored by `rig/fake_meet` per #8): tile roots, `span.notranslate` names, `visual_effects` self icon, `[jsname="QgSmzd"]`+`sxlEM` speaking class with a 300 ms hold, `[role="region"][aria-label="Captions"]` band. Day-0 probe results (issue #47) are ported; the module still reads through one convention table.
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

Probe port (issue #47) on branch `feature/meet-adapter-probe-selectors`: CONVENTIONS + conventions.md carry the real selectors; speaking moved to the `sxlEM` class on the `QgSmzd` descendant (change-only, 300 ms hold); self moved to the `visual_effects` icon; names to `span.notranslate`; captions to the region band with a text-region fallback. 19/19 Vitest green, `tsc` clean. Next: commit, push, open PR.

## Open questions

- (2-person live test, gate 4) Still to confirm on real Meet: self marker on the other tile, speaking class on a remote tile, multi-tile ids, pinning/resizing, and the Arabic captions aria-label (fallback covers it meanwhile).
