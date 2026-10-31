# recorder: STATE

## Goal
Implement recorder per its PLAN.md; done ONLY when `uv run pytest backend/halo/recorder -q` passes and the contract tests for recorder pass.

## Key decisions
- Seams under test (no user to confirm; recorded here): the `Recorder` class (`ingest`/`finalize`/file+sidecar artifacts) and its bus subscriptions (`meeting.started`/`meeting.ended`). Tests never touch internals.
- `Recorder(bus, data_dir, rec_queue, max_staging_bytes)`; subscribes in `__init__` (insight pattern); `start()`/`stop()` own the background drain task (lifespan pattern, no loop — nothing to flush on stop beyond best-effort).
- Rec queue items are the gateway's `(seq, ts_ms, webm)` tuples (header already stripped in `gateway/audio.py`); malformed items dropped with a log line.
- Lazy file open on first chunk (PLAN says open on `started`; deviation: avoids empty files for unrecorded meetings and makes file-start coverage exact — reason in PR). File start `ts_ms` = first chunk's `ts_ms` (mid-meeting switch-on falls out naturally).
- Files: `recordings/{meeting_id}.webm` exactly for the first covering file (honors #37); re-record after a mid-meeting gap starts `{meeting_id}.2.webm`, etc. Index sidecar `recordings/{meeting_id}.index.json`: `{meeting_id, t0_ms, files: [{path, start_ts_ms, chunks: [[ts_ms, offset]]}]}` (offsets = payload start in file). No bus events, no health slot (no room in `system.status`), no `recording.ready` — per PLAN.
- Ordering: per-file monotonic `seq` (drop + log any `seq <=` last written — the queue is FIFO from one producer, so this is lossless in practice).
- Spill: staging `bytearray` capped by `max_staging_bytes`; overflow appends to `<path>.spill` in arrival order; flush writes staging then drains spill, then deletes it. A fake slow file + tiny cap exercises the path deterministically.
- `meeting.ended` finalizes exactly once per `meeting_id` (first wins; later ones + post-finalize chunks dropped with a log line).

## Task graph
1. [x] `recorder.py`: meetings, ingest, staging/spill, finalize, index, loop
2. [x] `tests/test_recorder.py`: 8 tests covering the 5 PLAN cases
3. [x] `app.py` wiring (construct + lifespan start/stop)
4. [x] Comment on #37 confirming the path convention + sidecar
5. [x] PR #44 open for Karim to merge

## Assumptions (for the reviewer)
- Lazy file open on first chunk (PLAN says open on `started`): avoids empty files for unrecorded meetings and makes file-start coverage exact.
- Rec-chunk tuples carry no meeting id (gateway strips it), so chunks attribute to the latest live meeting; zero live → drop + log.
- A ts gap over `GAP_SPLIT_MS` (30 s) starts a new covering file (`{id}.2.webm` …); the first file is always exactly `recordings/{meeting_id}.webm` per #37.
- Per-file monotonic `seq` (dupes/out-of-order dropped + logged); failed flushes truncate back and re-park every byte in spill for retry.
- Sidecar rewritten on every flush (fresh for notes_service at all times); `covering_file()` is the read helper notes_service will use.

## File map
- `backend/halo/recorder/recorder.py` — `Recorder`
- `backend/halo/recorder/__init__.py` — re-exports
- `backend/halo/recorder/tests/test_recorder.py` — the PLAN suite
- `backend/halo/app.py` — composition-root wiring (allowed exception)

## Current step
Done: 8 lane tests + 121 full pass; ruff/mypy/lint-imports clean; app.py wired. Branch `module/recorder` pushed; PR open for Karim.

## Open questions
None yet.
