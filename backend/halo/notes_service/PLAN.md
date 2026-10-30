# notes_service: PLAN

## Job
Wave 4 (W1, Nov 2). Ring 2. The Notes HTTP service: an `APIRouter` mounted by `app.py` on the one FastAPI app (`127.0.0.1:8765`). Serves the static Notes page shell and its JSON: meetings list, per-meeting page JSON, FTS5 search, Markdown export, point → transcript line → recording moment links. Merges tags via the Event Store `tags_effective` view (user over model over original guess); groups actions Urgent / Medium / Later. Does not consume `notes.ready`; it reads stored notes from SQLite per request.

## Inputs (contracts consumed)
HTTP (JSON, no envelope): `GET /notes/{meeting_id}`, `GET /api/meetings/{meeting_id}`, `GET /api/meetings?project_id=`, `GET /api/search?q=`, `GET /api/meetings/{id}/export.md`, `POST /api/tags {target, target_id, kind?, urgency?}` (same field names as `tags.set`). Read-only SQLite: `events`, `meetings`, `points_current`, `tags_effective`, FTS5 index; Recorder file index for recording offsets.

## Outputs (contracts emitted)
HTTP JSON/HTML above; search hits `{meeting_id, point_id|turn_id, snippet, ts_ms}` (a non-event HTTP shape owned here). `POST /api/tags` validates the request and publishes `tags.set {…, source: "user"}` on the Bus (stored by the Event Store, forwarded by the Gateway to the Overlay). Serves the `notes-page/` files; `GET /notes/{meeting_id}` returns the same shell for every meeting and the shell fetches `GET /api/meetings/{meeting_id}` (meeting + people + points + actions with merged tags + transcript lines + recording offsets).

## Lane (the files it owns)
`backend/halo/notes_service/**` (+ `tests/`). The page assets themselves belong to `notes-page/` (W2).

## Depends on
`contracts`, `bus`, Event Store schema + views, Recorder index. Golden page JSON in `contracts` lets W2 build the page first.

## Fakes it tests with
A replay-seeded DB (`rig/replayer`); no LLM fake needed (this module calls no model).

## Done = tests
Run: `uv run pytest backend/halo/notes_service -q`. Concrete cases (diagram box: HTTP snapshots on a replay-seeded DB): (1) `GET /api/meetings/{id}` snapshot matches the seeded meeting: people, points with merged tags, actions grouped with urgency, transcript lines with `ts_ms`, recording offset = line `ts_start_ms −` covering-file start. (2) `?q=` search returns hits with snippets across meetings and honours `project_id` filtering on the list endpoint. (3) `POST /api/tags` with an invalid field → 422, nothing published; valid → one `tags.set (source: user)` on the bus and the next page JSON reflects it (user beats an earlier model tag). (4) Export Markdown snapshot contains points, actions, and transcript links. (5) Unknown `meeting_id` → 404 JSON, never a stack trace; the shell route still returns 200 HTML for any id.

## Cut line
Ring 2. ✂5 re-tag menu lives in the page; cutting it leaves this service storing `tags.set` unchanged. Never cut: the point → transcript → recording link (demo evidence).

## Doubts
Answered: no `notes.ready` consumption; shell + JSON split (batches 2–3). Answered (review): search searches all meetings (no `project_id` scoping on `/api/search` in the MVP; the list endpoint is the scoped one).
