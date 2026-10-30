# event_store: PLAN

## Job
Wave 2 build (W1, Oct 31 afternoon – Nov 1) because replay tests read `events.sqlite`; its search depth is ring 2. Appends every accepted envelope (Bus tap) to SQLite (WAL); envelope `id` UNIQUE is the second dedupe line. FTS5 over final transcript + point text. Meetings indexed by `project_id`. Data kept until the user deletes the data folder (`data/` at repo root, override `HALO_DATA_DIR`); no delete UI in the MVP. Owns the schema + views that the two read-only readers depend on — documented here as a contract.

## Inputs (contracts consumed)
Every accepted envelope via the Bus tap (all types). `data` stored untouched.

## Outputs (contracts emitted)
No bus events. Contract for readers: `events(seq PK, id UNIQUE, type, time, meetingid, source, data JSON)`; `meetings(meeting_id, platform, meeting_code, t0_ms, self_name)` created from `meeting.started`, `subject` + `project_id` from the latest `meeting.context`, `ended_at` + `reason` from the first `meeting.ended`. FTS5: `transcript.final.text` + latest `points.upsert.text` and `quote` only — no `turn.attributed` duplicates. Views: `points_current` (latest upsert per `point_id`, excluding any point another point `replaces`) and `tags_effective` (merge rule in one place: latest user tag > latest model tag > original guess). Recording offset for a point = `ts_start_ms − start ts_ms of the covering recording file` (Recorder index), never `t0_ms`, because recording can start late.

## Lane (the files it owns)
`backend/halo/event_store/**` (+ `tests/`, schema migrations, view definitions).

## Depends on
`contracts`, `bus` (tap + `register_health`).

## Fakes it tests with
Golden samples from `contracts`; the ACK test kit from `contracts` (run here for the duplicate → one-row behaviour); Replayer output DB (L2 compares `events.sqlite` to the golden).

## Done = tests
Run: `uv run pytest backend/halo/event_store -q`. Concrete cases: (1) duplicate envelope `id` → one row. (2) `meeting.started` + late `meeting.context` → one `meetings` row with latest subject/`project_id`; second `meeting.ended` does not overwrite `ended_at`/`reason`. (3) FTS finds a transcript phrase and a point quote; a superseded point version is not returned. (4) `points_current` excludes a replaced point and shows the replacement; `tags_effective` returns user over model over Insight guess for the same target. (5) L2: replayed fixture DB matches `expected.jsonl` (ts ±300 ms, fuzzy text, ids ignored, order per tile). (6) WAL mode on; readers can open the DB read-only while the writer runs.

## Cut line
Ring 2 for search depth only; the store itself is Wave 2 and never cut (replay tests read it). FTS tuning and any Recall/RAG are post-MVP (roadmap needs `project_id`, already stored).

## Doubts
Answered: views own the tag-merge rule; deletion is folder-level only; covering-file recording offset (batch 4). Answered (review): FTS5 external-content tables keyed by `events.seq`; if that complicates the views, plain FTS5 tables with rowid = `events.seq` are acceptable — schema contract above is what readers may rely on.
