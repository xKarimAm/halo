# transcriber: STATE

Goal: Implement transcriber per its PLAN.md; done ONLY when `uv run pytest backend/halo/transcriber -q` passes with FakeASR + fixture cases.

## Key decisions

- Three files: `protocol.py` (Voice WS handshake/builders + turn-event parser, pure), `session.py` (`TranscriptionSession`: one WS connection, real-time pacer, anchor/offset clock map, reconnect, 59-min rotation), `transcriber.py` (`Transcriber`: two sessions on the app queues, bus in/out, health).
- Engine boundary: engines yield turns as (text, speaker, lang, start_ms, end_ms, relative:bool). `relative=True` = offsets from session audio position (real Voice assumption A2; FakeTransport converts FakeASR-core absolute ts by subtracting the anchor). `relative=False` = absolute ms used as-is (fake WS server wall-clock path, plumbing only).
- Queue frames parsed with `contracts.binary` (kind=1; stream byte selects session; seq gaps → silence pad + log; kind=2 rejected loudly).
- Anchor per stream = first frame `ts_ms`; `ts = anchor + offset`. Mic ENDPOINTING forces speaker "you"; tab DIARIZATION passes A/B labels. Lang normalized (arabic→ar, english→en, else passthrough); unknown → "mixed".
- Endpoint URL from `rig.fakes.config.engine_config()["asr_url"]` (the HALO_FAKES swap seam; no test-only branches). Key from `META_API_KEY`. Skill URL (`/v1/asr/realtime`) vs config URL (`/v1/voice/realtime`): following the config (tested seam); noted in PR.
- `websockets` appended to backend deps (asyncio-native WS client; own-dep append allowed).
- `meeting.ended` closes both sessions once per meeting_id (first wins; id set). Health: ok | reconnecting | down; registered as `asr`.
- Rotation at 59 min: close + fresh session at current queue position (no backfill); speaker labels reset — Correlator re-locks by agreement. No rotation envelope exists in contracts; filed as issue (see PR), meanwhile log + health.
- Tests use FakeASR core via FakeTransport (meeting-clock asserts) + one TestClient WS roundtrip (plumbing: handshake→audio→final; ts asserted monotonic only, per the wall-clock seam). No network, no keys, no real audio in repo.

## Assumptions (unattended run, recorded here + PR body)

- A1: bus API unchanged by the parallel window (same as event_store A1).
- A2: real Voice returns turn spans as offsets relative to session audio (not absolute wall ms); if the live API sends absolute, one-line change (`relative=False`).
- A3: handshake shape `{authorization: {accessToken}, mode, languageBias, keywords}` per the voice skill; server-ignored extras are harmless.
- A4: fake WS server hardcoded `feed_audio("tab", wall_clock, …)` is a rig gap for mic + meeting-clock alignment → filed `module:fakes` issue; not blocking (core covers both streams).
- A5: day-0 arabic-asr probe outcome unknown → languageBias ["arabic","english"] stays; demo-leans-English needs no code change.

## Task graph

1. [x] Worktree `.tmp/wt-transcriber` on branch `module/transcriber` from origin/main; inbox empty; voice skill loaded.
2. [ ] `protocol.py` + `session.py` + `transcriber.py` with tests (PLAN cases 1-6).
3. [ ] `pyproject.toml` websockets dep; `app.py` wiring (queues already in app.py; add Transcriber boot + health).
4. [ ] Full gates (pytest, ruff, lint-imports, mypy); file fakes (+contracts rotation?) issues; commit per piece; push; PR.

## File map

- `backend/halo/transcriber/STATE.md`, `PLAN.md`, `protocol.py`, `session.py`, `transcriber.py`, `tests/`.
- Seams (read-only): `contracts/binary.py`, `rig/fakes/{fake_asr,server,config,scripts}.py`, `.agents/skills/meta-model-api/voice.md`.

## Current step

Tasks 2-3 done: 14/14 module tests green, full suite 45 passed, ruff/lint-imports/mypy clean. Issues filed: #23 (fakes WS server), #24 (rotation event proposal). Next: commit per piece, push, open PR.

## Open questions

- (fakes, to file) WS server hardcodes tab stream + wall-clock ts; needs session-routed stream/anchor for mic + L2 timing.
- (contracts, to file?) Rotation event for Correlator re-map (skill asks, contracts has no such type). File as proposal; proceed with log+health.
