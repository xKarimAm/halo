# recorder: PLAN

## Job
Wave 4 (W1, Nov 2). Ring 2. Converter: binary `kind=3` webm chunks (tab video + tab audio + your mic) in, local files out — everything stays on this PC, kept until the user deletes the data folder. Maintains a `ts_ms` index on the meeting clock so the Notes page can seek a recording moment. Finalizes the file on `meeting.ended`. Cloud upload is a later option, not built.

## Inputs (contracts consumed)
Binary `kind=3` chunks from the bounded rec queue wired in `app.py` (produced by the Gateway; the Hub simply starts/stops sending when the Recorder switch flips — no envelope). Bus: `meeting.started` (open file), `meeting.ended` (finalize; act once per `meeting_id`, first wins).

## Outputs (contracts emitted)
No bus events (no `recording.ready` in the MVP). The `recording` file index — `{meeting_id, path, t0_ms / file start ts_ms, ts_ms_index}` — a non-event record owned here, read by Notes Service. Point/recording offset = `ts_start_ms − start ts_ms of the covering file` (recording can start after `t0_ms`).

## Lane (the files it owns)
`backend/halo/recorder/**` (+ `tests/`). Files land under the data dir (`data/` or `HALO_DATA_DIR`).

## Depends on
`contracts` (binary framing), `bus` (lifecycle), Gateway queue wiring in `app.py`.

## Fakes it tests with
Replayed rec chunks from the synthetic fixture (`rig/replayer`); no engine fakes.

## Done = tests
Run: `uv run pytest backend/halo/recorder -q`. Concrete cases (diagram box: replayed rec chunks → file + index): (1) fixture chunks append losslessly in `seq` order to one file per meeting; the index maps chunk `ts_ms` to file offsets. (2) Disk lag → spill to temp, then drain without losing or reordering chunks. (3) `meeting.ended` finalizes exactly once (second `meeting.ended` ignored). (4) Recording switched on mid-meeting: first file's start `ts_ms` > `t0_ms`, and Notes offset math uses that start (integration check with Notes Service seeded data). (5) Chunks for an unknown/ended meeting are dropped with a log line, never a crash.

## Cut line
✂3: drop video, keep transcript links (Hub stops sending `kind=3`; transcript links in Notes keep working). Never cut: the transcript half of the link.

## Doubts
Answered: index is a non-event; no `recording.ready` (batches 1, 4). Answered (review): one webm file per meeting per recording-on period (switching off and on starts a new covering file; the index lists them in `ts_ms` order).
