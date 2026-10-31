# correlator: STATE

Goal: Implement correlator per its PLAN.md; done ONLY when `uv run pytest backend/halo/correlator -q` passes (all 9 cases).

## Key decisions

- `Correlator` subscribes transcript.final / tiles.snapshot / speaker.active / meeting.started / meeting.ended; emits turn.attributed per final turn + speaker.mapped on lock/lock-change; registers internal `correlator` health (not part of system.status).
- Knobs as module constants: `LAG_MS=500`, `LOCK_AFTER=3`, `ECHO_WINDOW_MS=2000`, `HOLD_TIMEOUT_S=10` (hold timeout + wall clock injectable for tests).
- Lit evaluation: per-tile latest highlight; lit = speaking with event ts <= turn.ts_start + LAG_MS. Overlap (2+ lit) → provisional + most-recently-active tile.
- Lock: last LOCK_AFTER turns for a diarized speaker agreeing on one tile → speaker.mapped locked:true with corrects[] = earlier turn_ids sent to other tiles. Re-lock on new agreement emits a new mapped (same shape).
- Mic turns (stream mic) → is_self tile, locked; unknown self tile yet → held under the same 10 s rule, then self tile.
- No snapshot yet → hold (asyncio timer, max HOLD_TIMEOUT_S) → release provisional to most-recently-active non-self tile (fallback first non-self, then only tile); expiry → drop + logged warning (the only drop).
- Echo: mic turn whose normalized text equals a tab line within ±ECHO_WINDOW_MS → dropped + logged. One direction only (mic repeats tab).
- No tiles lit at all → provisional best-available tile (same selection as release). Never swallowed otherwise.
- meeting.started/ended resets locks, holds, tiles, echo history (timers cancelled).
- turn.attributed reuses the final's turn_id (link key for Insight/Event Store).
- Wiring: construct + subscribe in app.py (no tasks owned except per-hold timers on the running loop).

## Assumptions (unattended run, recorded here + PR body)

- A1: bus API unchanged by the parallel window.
- A2: speaker labels (A/B/you) arrive exactly as Transcriber emits; no normalization here.
- A3: hold timers via loop.call_later; under tests the loop runs (asyncio.run) with a short injected timeout.
- A4: release/health edge choices (fallback tile order, guess-free) as documented above; L4 tunes knobs on real calls.

## Task graph

1. [x] Worktree `.tmp/wt-correlator` on branch `module/correlator` from origin/main; inbox empty.
2. [ ] `correlator.py` + `tests/test_correlator.py` (PLAN cases 1-9).
3. [ ] `app.py` wiring; gates (pytest, ruff, lint-imports, mypy); commit per piece; push; PR.

## File map

- `backend/halo/correlator/STATE.md`, `PLAN.md`, `correlator.py`, `tests/`.
- Oracles (read-only): golden `transcript.final`/`turn.attributed`/`speaker.mapped`/`tiles.snapshot`/`speaker.active` JSON.

## Current step

Tasks 2-3 done: 10/10 module tests green, full suite 41 passed, ruff/lint-imports/mypy clean. No cross-module issues. Next: commit per piece, push, open PR.

## Open questions

None blocking. No cross-module issue expected (depends only on contracts + bus + fellow-tap Event Store).
