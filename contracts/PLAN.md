# contracts: PLAN

## Job
Wave 0 (W1, Oct 31 morning). The only thing modules share: CloudEvents 1.0 envelope + ACK rules (ACK on the extension⇄Gateway socket only), two-plane rule (binary = no envelope/no ACK; envelopes = control), one JSON Schema per event type + markdown catalog (type → emitter → consumers), clock + coordinate rules, `MeetingAdapter` interface, Port union, codegen to pydantic + TS, one golden sample per type. Done = every golden sample validates, codegen committed, CI green.

## Inputs (contracts consumed)
- Authoritative field names from the diagram grey boxes (`docs/architecture/halo-v2-final.drawio`) and `docs/DECISIONS.md` §4–5.

## Outputs (contracts emitted)
- Schemas + generated types for: `pair.hello|pair.ok|pair.rejected`, `meeting.started|meeting.ended`, `system.status`, `meeting.context`, `tiles.snapshot`, `speaker.active`, `transcript.final`, `turn.attributed`, `speaker.mapped`, `points.upsert`, `llm.health`, `tags.set`, `notes.ready`, envelope `{specversion, id, type, source, time, meetingid, datacontenttype, data}`, ACK `{ack_of, status, error?{code, message}}`.
- Binary framing: little-endian; audio `[kind=1 u8][stream u8 0=tab,1=mic][seq u32][ts_ms u64]` + PCM16; rec `[kind=3 u8][seq u32][ts_ms u64]` + webm; `kind=2` reserved, reject. No envelope, no ACK, no id on binary.
- `contracts/ext/port.ts`: Port discriminated union (TS only, no JSON Schema, no Port ACK), including `set_viewer_lang {viewer_lang}` (Overlay → hub; the hub re-sends its latest `meeting.context` with the new language). `MeetingAdapter` TS interface. Golden page JSON for `GET /api/meetings/{meeting_id}` so W2 builds the Notes page before Notes Service lands.
- The ACK test kit (fixtures + expected behaviour, shipped here, run by the modules that own the behaviour): drop-ACK → same `id` resent; duplicate → ACK `ok`, one stored row. Contracts cannot test hub or Event Store behaviour before those modules exist; `gateway`, `hub_capture` and `event_store` run this kit inside their own tests.
- ACK error codes (closed): `invalid_schema | unknown_type | unpaired | internal`. `unpaired` = envelope before `pair.ok`. Duplicate id → ACK `ok`, not re-published. Pair rejection is `pair.rejected`, never an ACK error.
- Pinned enums: kind `point|question|decision|pushback`; urgency `urgent|medium|later`; `viewer_lang` `en|ar`; turn `lang` `ar|en|mixed`; `attribution` `provisional|locked`; `rank` int 1–3; ids UUID strings; times integer ms, browser meeting clock; envelope `time` = server wall clock, logs only. `meetingid` required on every type except `pair.*`, `system.status`, `llm.health` (global, null allowed). Coordinates: boxes 0..1 of the source frame; `rect` = `getBoundingClientRect`, viewport CSS px; `tile_id` = Meet `data-participant-id`.
- Inferred, Karim to confirm (flagged per planning batch 1): every enum above where the diagram named no domain; `meeting.context.agenda: string[]`, `roles[].role` optional; `tiles.snapshot.captions_rect: [x,y,w,h] | null` (null = captions off/not found, Overlay applies no floor); `notes.ready.degraded: bool`; `rank` range 1–3; HTTP `GET /api/meetings/{meeting_id}` page-JSON shape (diagram HTTP box lacked it; Claude updates the diagram).

## Lane (the files it owns)
`contracts/**`: `*.schema.json` (one per type), `catalog.md`, `golden/*.json`, `codegen.py` (`uv run python -m contracts.codegen`, `--check` = drift check), `ext/port.ts`, `ext/meeting-adapter.ts`, generated `gen/pydantic/` + `ext/gen/`, `tests/` (L0). Wave 0 also creates root scaffolding (`pyproject.toml`, `extension/package.json`, `.github/workflows/ci.yml`, PR template, `.gitignore`, `.env.example`) **and `backend/halo/app.py`** (Bus + FastAPI app skeleton, so `uv run halo` boots on Oct 31; each W1 backend module PR later adds its own wiring lines there — the one allowed lane exception). Packaging owns the root files from then on; `wxt.config.ts` + the manifest belong to `hub_capture`, never Packaging. Any later contract change: `contract-change` label, Karim merges.

## Depends on
DECISIONS + diagram only. Day-0 probes: none block contracts; probe fallbacks already locked (see master plan).

## Fakes it tests with
None. Golden samples are the fakes every other module tests against.

## Done = tests
Run: `uv run pytest contracts -q` and `uv run python -m contracts.codegen --check`. L0 here is contracts' own surface only — schemas, golden samples, codegen, binary headers. Concrete cases: (1) every `golden/*.json` validates against its schema; invalid variants (missing `type`, wrong kind enum, `rank: 4`, non-UUID id) reject. (2) Codegen committed: `--check` passes with no drift. (3) The ACK test kit ships with fixtures + expected behaviour (drop-ACK → same `id` resent; duplicate → ACK `ok`, one row) and its README names the runners: `gateway`, `hub_capture`, `event_store` execute it in their own suites — no hub/store behaviour is asserted here. (4) `kind=2` header rejected; `kind=1/3` headers round-trip little-endian (incl. stream bytes 0 = tab, 1 = mic). (5) `meetingid: null` validates for `pair.*`/`system.status`/`llm.health` and rejects for `points.upsert`. (6) import-linter config lists every backend lane (with `app.py` as the single allowed exception). CI green (L0 blocking from Wave 0).

## Cut line
Never cut: contract validation. No features to cut; scope is one schema per diagram type, no extras.

## Doubts
None open. All batch 1–5 answers recorded above. Default applied while Karim away: none needed here.
