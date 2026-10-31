# event_store: STATE

Goal: Implement event_store per its PLAN.md; done ONLY when `uv run pytest backend/halo/event_store -q` passes, including the contracts ACK-kit duplicate case.

## Key decisions

- `EventStore(path)`: sqlite3, WAL on, `events(id UNIQUE)` as the second dedupe line (`INSERT OR IGNORE`; `append` returns stored bool). Tap is a sync callable registered via `bus.set_tap` (bus tolerates sync results).
- `meetings` row: created by first `meeting.started` (INSERT OR IGNORE), subject/project_id from latest `meeting.context`, `ended_at`/`reason` from first `meeting.ended` only.
- FTS5: plain tables `transcript_fts(text, seq UNINDEXED)` / `points_fts(text, seq UNINDEXED)` with rowid = `events.seq` (review-allowed simpler shape). Transcript indexes finals; points index latest upsert text+quote per point_id only (old versions + `replaces`-targets deleted).
- Views: `points_current` (latest upsert per point_id, replaced points excluded); `tags_effective` (latest user > latest model > original guess; guess rows carry source 'guess').
- Recording offset = `ts_start_ms - covering recording file start` is a READER-side computation (Recorder owns the file index); the store exposes transcript `ts_start_ms` + recording rows untouched. Assumption: no recording-file table in this lane (not in the schema contract).
- Readers (`points_current`, `tags_effective`, search helpers) are plain methods returning dicts/lists. Health: `health_status()` returns "ok"; registered on the bus as `event_store`.
- L2 case: publish the committed synthetic fixture envelopes through a real Bus + tap, assert every envelope stored once and redelivery dedupes (uses `rig/replayer` loader + `checker` where they fit; no new fixtures committed).
- Wiring: each PR adds its own `app.py` lines (data dir `HALO_DATA_DIR` or `data/`, `bus.set_tap`, `register_health`).

## Assumptions (unattended run, recorded here + PR body)

- A1: bus API on main (`subscribe/publish/set_tap/register_health/health`, dict envelopes, sync-tap tolerated) is final; the other window's bus work does not change these signatures.
- A2: `data/` dir convention (`HALO_DATA_DIR` override) per DECISIONS/PLAN; tests use tmp_path and never touch the real dir.
- A3: `tags_effective` guess-row `source='guess'` (outside the tags.set model|user enum) is acceptable to Notes Builder/Service; flagged in the PR for W1 review.
- A4: Gateway (other window) dedupes by envelope id before the bus, so the store's UNIQUE line is purely the second line; the ACK-kit duplicate test proves one-row behavior through publish→tap.
- A5: L2 full-golden comparison stays owned by `rig/replayer` tests; this lane asserts fixture envelopes land once + dedupe (same oracle, store-level).

## Task graph

1. [x] Worktree `.tmp/wt-event_store` on branch `module/event_store` from origin/main; inbox empty.
2. [ ] `store.py` + `tests/test_store.py` (PLAN cases 1-4, 6 + ACK duplicate + fixture replay).
3. [ ] `app.py` wiring lines; `uv run pytest backend/halo/event_store`, ruff, import-linter, mypy.
4. [ ] Commit per piece; push; PR.

## File map

- `backend/halo/event_store/STATE.md`, `PLAN.md` (read-only contract).
- `backend/halo/event_store/store.py` — EventStore (schema, tap, views, readers).
- `backend/halo/event_store/tests/test_store.py` — suite.
- `backend/halo/event_store/__init__.py` — re-export.
- Oracles (read-only): `contracts/ack-kit/duplicate.json`, `contracts/golden/*.json`, `rig/replayer/fixtures/synthetic/*`.

## Current step

Tasks 2-3 done: 9/9 module tests green, full suite 40 passed, ruff/import-linter/mypy clean, app wiring smoke-verified (publish→ack ok→1 row→health). Next: commit per piece, push, open PR.

## Open questions

None blocking. A3/A5 flagged for reviewers in the PR body.
