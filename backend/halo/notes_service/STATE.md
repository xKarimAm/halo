# notes_service: STATE

## Goal
Implement notes_service per its PLAN.md; done ONLY when `uv run pytest backend/halo/notes_service -q` passes and the contract tests for notes_service pass.

## Key decisions
- `NotesService(bus, data_dir, static_dir)` + module `router` (gateway pattern: handlers use `request.app.state.notes_service`). No bus subscriptions except the tags POST publish; no loop; no health registration (no status slot).
- Routes (registration order matters): `GET /notes/app.js`, `GET /notes/styles.css` (explicit files, since a mounted dir would swallow unknown ids), then `GET /notes/{meeting_id}` shell (404 unknown), `GET /api/meetings[?project_id]`, `GET /api/meetings/{id}` page (404 unknown, 500 if the assembled page ever fails schema), `GET /api/search?q=`, `POST /api/tags`, `GET /api/audio?meeting_id=&turn_id=`.
- Page JSON per the #14 schema, assembled read-only from `meetings` + `events` (same mirror approach as notes_builder, own copy — lane independence): people/actions prefer the latest stored `notes.ready` event (stable action ids); before the builder runs, a live fallback (people from turns, suggested actions from `is_action` points with uuid5 ids, `degraded: True`).
- List: `[{meeting_id, subject, people:[names in first-appearance order], date:"Thu 09 Oct" UTC}]`, t0 DESC, `?project_id=` exact filter. People/date feed card avatars/subtitles per the client.
- Assumptions (recorded for the reviewer): page `people[]` strips the builder's nested per-person `actions` (page keeps actions top-level only per #14); page `actions[]` = one per live `is_action` point enriched from stored ready actions by `action_id`, so ready actions with no live point are dropped (they cannot satisfy required `point_id`); fallback actions are `status: suggested` per the builder PLAN; page validated at serve time with the generated `MeetingPage` model (codegen dogfood, no jsonschema dep); week label formatted with explicit UTC so CI/Windows agree.
- Search: `{hits:[{meeting_id, subject, snippet(±60 chars), line, speaker?, scope, kind?, urgency?, kindLabel}]}`; `line` is always a turn_id when jumpable else null (client matches it against transcript turn_ids); actions searched from `is_action` points so they stay jumpable; missing q → 400, empty q → `{hits: []}`, cap 100, meetings t0 DESC.
- Tags POST validates target enum + kind/urgency enums, requires ≥1 of kind/urgency, resolves the target's meeting (points by id; actions by `is_action` point id or stored `notes.ready` action id), publishes `source: user` with that meeting, returns 201 + envelope. Unknown target → 404.
- Audio: unknown → 404; `ended_at NULL` → 429; `turn_id` present → 501 (no recorder index yet); missing file → 404; else the webm (`recordings/{meeting_id}.webm` per issue #37).
- `static_dir` defaults to the repo `notes-page/` (dev layout); missing files → 404, never a crash. `data_dir` defaults to `HALO_DATA_DIR` or `data`.
- Answers issue #15 (list/search shapes + page route + tags response) from the PR; `Fixes #15`.

## Task graph
1. [x] `notes_service.py`: readers, page/list/search/tags/audio, static
2. [x] `tests/test_notes_service.py`: all 8 PLAN cases against a seeded DB
3. [x] `app.py` wiring (construct + mount router)
4. [x] Answer #15 with implemented shapes
5. [ ] PR open for Karim to merge

## File map
- `backend/halo/notes_service/notes_service.py` — `NotesService` + `router`
- `backend/halo/notes_service/__init__.py` — re-exports
- `backend/halo/notes_service/tests/test_notes_service.py` — the PLAN suite
- `backend/halo/app.py` — composition-root wiring (allowed exception)

## Current step
Done: 8 lane tests + 121 full pass; ruff/mypy/lint-imports clean; app.py wired. Branch `module/notes_service` pushed; PR open for Karim.

## Open questions
None (route/shape/code choices above are the #15 answer for the reviewer).
