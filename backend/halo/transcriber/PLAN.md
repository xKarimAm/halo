# transcriber: PLAN

## Job
Wave 2 (W1, Oct 31 afternoon – Nov 1). Converter: binary audio in, envelopes out. Critical path. Two Muse Voice Transcribe realtime sessions (tab = diarization, mic = endpointing as `you`), language bias Arabic + English. Paces PCM to Voice, maps ASR offsets onto the meeting clock (`ts = anchor_ts + offset`; keeps `seq → ts_ms` of the frames it paced, pads included). Emits final turns only. Closes both sessions on `meeting.ended`. No diagram-external event types.

## Inputs (contracts consumed)
Binary `kind=1` audio from the bounded tab/mic queues wired in `app.py` (no envelope, no ACK). Bus: `meeting.started` (open sessions), `meeting.ended` (close both; act once per `meeting_id`, first wins).

## Outputs (contracts emitted)
`transcript.final {turn_id, stream: tab|mic, speaker: A|B|…|"you", text, lang: ar|en|mixed, ts_start_ms, ts_end_ms}` on the Bus. Health callable for `system.status` (`asr: ok|reconnecting|down`).

## Lane (the files it owns)
`backend/halo/transcriber/**` (+ `tests/`). Wraps Voice (Meta API); the Voice API box itself gets no PLAN.

## Depends on
`contracts`, `bus`, Gateway queues (via `app.py`). Day-0 `arabic-asr` probe (Egyptian + Jordanian): poor result ⇒ demo leans English + tune bias/keywords, no plan change (DECISIONS §5 records outcomes).

## Fakes it tests with
FakeASR (`rig/fakes`): speaks the Voice realtime WS protocol, emits the fixture's scripted turns at offsets matching the audio received; knobs: latency, forced session drop, AR/EN code-switch.

## Done = tests
Run: `uv run pytest backend/halo/transcriber -q`. Concrete cases (FakeASR + fixture): (1) turn `ts_start` within ±200 ms of truth, `ts_end > ts_start`, monotonic `ts_ms`. (2) Tab turns carry diarized speakers (`A`, `B`, …); mic turns carry `you`. (3) Code-switched AR/EN lines map to `lang: mixed` without splitting the turn. (4) Seq gap in audio → silence pad, gap logged, timestamps stay on the meeting clock. (5) Forced session drop → health `reconnecting`, then `down`; that audio's transcript is lost (accepted; recording still holds the audio — separate path). (6) `meeting.ended` closes both sessions exactly once, including when a second `meeting.ended` arrives.

## Cut line
Never cut (critical path). Transcript recovery for dead-ASR audio is post-MVP.

## Doubts
Answered: dead-ASR loss model + `system.status` surfacing (batch 4). Answered (review): pacing is real-time (1×) to Voice; on reconnect, a fresh session starts at the current queue position (no backfill).
