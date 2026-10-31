# notes_builder: STATE

## Goal
Implement notes_builder per its PLAN.md; done ONLY when `uv run pytest backend/halo/notes_builder -q` passes and the contract tests for notes_builder pass.

## Key decisions
- Trigger chain per PLAN: `meeting.ended` → this module → `notes.ready`. The "V1" is the live-path candidate the builder assembles itself from Event Store state (no model): no module on main emits a draft for it to consume.
- Emission rule (documented reading of "ONCE per meeting" + LKG): each `meeting.ended` is processed serialized under an `asyncio.Lock` (no interleave across meetings). A freshly validated page emits at most once per meeting; if a later `meeting.ended` for the same meeting fails V1 and the single rebuild, the stored last-known-good page re-emits (same data). When both fail and no LKG exists, the live V1 page emits with `degraded: true` (actions `suggested`, `why` empty; PLAN fallback), so every meeting ends with a `notes.ready`.
- Reads Event Store SQLite read-only: the `meetings` row plus `events` rows (`turn.attributed`, `points.upsert`, `tags.set`, latest `meeting.context`) — the only base tables (turns/points/tags live in `events` as JSON). The documented `points_current` / `tags_effective` semantics (latest-seq wins, `replaces` drops, user rows win per field) are mirrored in Python so this lane never imports the owning module; no views, no FTS, no writes. Effective kind/urgency reach the page, so classifier corrections apply.
- Validation (before any model call, zero extra latency): page-schema shape + quote-verbatim-in-turns + every point/turn/person field equal to store (effective) values + every point's turn_ids resolving to transcript turns + every person/action row tracing to ≥1 turn via point turn_ids + no ids outside the store.
- Rebuild = exactly one contributor-shaped call (injected duck-typed client like other lanes) with transcript + candidate points + V1 text + violations; prompt orders repair from store values verbatim. Re-validated; on pass emits.
- V1 heuristics (live path has no model): `own_points` = spoken points, `relevant_points` = []; actions from `is_action` points (`status: assigned`); `role`/`why` from context roles or Participant; `degraded` = no turns; `recording.path` = `recordings/{meeting_id}.webm` convention for the recorder lane (issue filed); `subject` from meetings row or "Untitled meeting"; `project_id` omitted when unknown.
- `notes.ready` data is derived from the validated page (actions grouped by owner, `point_id` stripped per schema). `llm.health` publishes only on an engine flip away from `spark-open`.
- `app.py` constructs `NotesBuilder(bus, llm, db_path)`; no loop, no health registration.
- Tests seed their SQLite with a local helper (plain `sqlite3`, minimal DDL mirrored from `store.py` — only columns read; header cites the source of truth). No `halo.event_store` import anywhere in the lane. The PLAN's "replay-seeded DB" belongs to L2, not unit tests.

## Task graph
1. [x] `notes_builder.py`: store read, V1 assembly, validation, rebuild, emit, LKG
2. [x] `tests/test_notes_builder.py`: all 6 PLAN cases against scripted model + seeded DB
3. [x] `app.py` wiring (construct only)
4. [x] recorder-path convention issue filed (#37)
5. [x] Full suite green (120 incl. lane 7) + ruff/lint-imports (mypy: only the pre-existing jsonschema-stub note); PR open for Karim to merge

## File map
- `backend/halo/notes_builder/notes_builder.py` — the `NotesBuilder` class
- `backend/halo/notes_builder/__init__.py` — re-exports
- `backend/halo/notes_builder/tests/test_notes_builder.py` — the PLAN suite
- `backend/halo/app.py` — composition-root wiring (allowed exception)

## Current step
Building; branch `module/notes_builder`.

## Open questions
None (V1-source, emission rule, recording convention, seed-DDL choices above are recorded for the reviewer).
