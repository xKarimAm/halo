# frame_source: STATE

Goal: Implement frame_source per its PLAN.md; done ONLY when `npm --prefix extension test` passes and the contract tests for frame_source pass.

## Key decisions

- `FrameSource` polls an injected `listTiles` (in-tab adapter call: snapshot order + `<video>` refs; the content-script wrapper wires the real one) on a `setInterval` at `1000/fps` (default 10 fps).
- Canvas creation is injected (`createCanvas`); production passes OffscreenCanvas, tests pass a fake. One canvas per tracked tile, reused across frames; `transferToImageBitmap()` per frame (transfer, not copy).
- First 6 tiles by provider (snapshot) order; video-less tiles skipped silently (Frame mode downstream); nothing in this module touches the Port or socket (import-linter + CI enforce lanes).
- No DOM needed in tests (fake videos + fake canvas) → node env, no new devDeps, no tsconfig change. Import depth `../../../contracts` verified in the real-depth replica before shipping (setup_panel lesson).
- Rig `fake_meet` not landed: tests use fake video/canvas doubles at mismatched aspect ratios.

## Task graph

1. [x] Worktree `.tmp/wt-frame_source` on branch `module/frame_source` from origin/main.
2. [ ] `frame_source.ts` + `frame_source.test.ts` (red then green, fake timers).
3. [ ] `tsc` + full `npm test` verified at real repo depth (ci-real replica).
4. [ ] Commit; push; PR. No cross-module issue expected (depends on contracts TileFrame shape + adapter video refs via injected seam).

## File map

- `extension/src/frame_source/STATE.md` — this file.
- `extension/src/frame_source/PLAN.md` — the contract (read-only).
- `extension/src/frame_source/frame_source.ts` — `FrameSource` + seams.
- `extension/src/frame_source/frame_source.test.ts` — Vitest suite (node env).
- Oracles (read-only): `contracts/tileframe.schema.json`, `contracts/ext/meeting-adapter.ts` (`TileFrameMessage`).

## Current step

Tasks 2-3 done: 6/6 Vitest green, `tsc --noEmit` clean, wire-clean grep empty. Next: commit, push, open PR.

## Open questions

None. Probe fallback (no `<video>` → emit nothing) is the implemented behavior, not a question.
