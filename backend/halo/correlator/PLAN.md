# correlator: PLAN

## Job
Wave 2 (W1, Oct 31 afternoon – Nov 1). Critical path. Attaches a tile + name to every final turn — a turn is never dropped except the single timed-out case below. Mic (`you`) turns always go to the `is_self` tile with `attribution: locked`. Tab turns before lock: the tile lit when the turn started (provisional; Meet's speaking highlight trails audio, hence the lag knob). Locks after 3 agreeing turns; a disagreeing/late lock names the affected turns in `speaker.mapped.corrects[]`. Two tiles lit → `overlap: true` (stays provisional; demo script avoids crosstalk). Drops a `you` line that repeats a tab line within 2 s (headset echo). Tab turns arriving before any `tiles.snapshot`: held until the first snapshot (max 10 s), then attributed provisionally to the most recently active non-self tile; only if no snapshot ever arrives within 10 s is the turn dropped, with a logged warning (`tile_id` stays required). Tunable constants live here, not in contracts: `lag_ms = 500`, lock after 3 agreeing turns, echo window 2000 ms; Karim tunes them on the recorded calls (L4).

## Inputs (contracts consumed)
Bus: `transcript.final` (Transcriber), `tiles.snapshot` + `speaker.active` (Meet Adapter via Gateway), `meeting.started`/`meeting.ended` (reset per meeting).

## Outputs (contracts emitted)
`turn.attributed {turn_id, text, lang, ts_start_ms, ts_end_ms, tile_id, name, attribution: provisional|locked, overlap}` per final turn. `speaker.mapped {speaker, tile_id, name, locked, corrects?: [turn_id]}` when a speaker locks or a lock changes. Health callable (internal; not part of `system.status`).

## Lane (the files it owns)
`backend/halo/correlator/**` (+ `tests/`, knob constants at the top of the module).

## Depends on
`contracts`, `bus`, Event Store only as a fellow tap (no direct read — attribution is live state).

## Fakes it tests with
Scripted `speaker.active`/`tiles.snapshot` sequences + FakeASR turns via Replayer fixtures (wrong-highlight fixture → golden shows the fix).

## Done = tests
Run: `uv run pytest backend/halo/correlator -q`. Concrete cases: (1) turn starting while tile T is lit (within `lag_ms`) attributes to T, provisional. (2) Three agreeing turns lock the speaker; the locking `speaker.mapped` carries `locked: true`. (3) Wrong-highlight fixture: early turns provisional on the wrong tile, lock emits `corrects[]` with exactly those `turn_id`s. (4) Two tiles lit at turn start → `overlap: true`. (5) Mic `you` line repeating a tab line within 2000 ms is dropped; the same words after 2000 ms are kept. (6) A mic `you` turn attributes to the `is_self` tile, `locked`, even with no highlight. (7) A tab turn before any snapshot is held; the first snapshot releases it (provisional, most recently active non-self tile); no snapshot within 10 s → dropped with a logged warning (the only drop; assert both branches). (8) A turn with tiles but none lit still emits `turn.attributed` (provisional, best available tile) — never swallowed. (9) `meeting.ended` clears locks so the next meeting starts provisional.

## Cut line
Never cut (critical path). Knob tuning is L4 work, not a cut candidate.

## Doubts
Answered: knobs are module constants with the starting values above (batch 4). Answered (review): never drop a turn — mic turns lock to the self tile; tab turns wait for the first snapshot (max 10 s) and then take the most recently active non-self tile; the 10 s no-snapshot timeout (logged) is the only drop.
