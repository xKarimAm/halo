# Halo: master build plan

Locked inputs: `docs/DECISIONS.md` wins over this file. Diagram: `docs/architecture/halo-v2-final.drawio` (box = job, arrow = contract, grey Courier box = JSON type). Overlay tokens only from `docs/ui/overlay-mix-b.html`; geometry/timing/fit/motion/accessibility from `docs/ui/OVERLAY-UX.md`. Notes page from `docs/ui/notes-v2.html?palette=2`.

Terms (DECISIONS §8): waves = schedule (when). Rings = cut priority (what goes first). Windows W1–W3 = owner panes (DECISIONS §6; that table is the only owner map).

Conventions pinned in planning (batches 1–5, Karim 2026-10-30): ids are UUID strings. Every time is integer ms on the browser meeting clock. Kind `point|question|decision|pushback`. Urgency `urgent|medium|later`. `viewer_lang` `en|ar`. A turn's `lang` `ar|en|mixed`. `attribution` `provisional|locked`. `rank` integer 1–3 (1 = most important). Flag `inferred, Karim to confirm` in `contracts/PLAN.md` for every field pinned this way.

## Module list: owner window and day

Day = build window, not a single due date. Critical path integrated first.

| Module | Folder | Owner | Day |
|---|---|---|---|
| Contracts | `contracts/` | W1 | Oct 31 morning (Wave 0) |
| Bus | `backend/halo/bus/` | W1 | Oct 31 afternoon – Nov 1 (Wave 2) |
| LLM client | `backend/halo/llm/` | W1 | Oct 31 afternoon – Nov 1 (Wave 2) |
| Gateway (incl. backend pairing) | `backend/halo/gateway/` | W1 | Oct 31 afternoon – Nov 1 (Wave 2) |
| Event Store | `backend/halo/event_store/` | W1 | Oct 31 afternoon – Nov 1 (Wave 2; search depth is ring 2) |
| Transcriber | `backend/halo/transcriber/` | W1 | Oct 31 afternoon – Nov 1 (Wave 2) |
| Correlator | `backend/halo/correlator/` | W1 | Oct 31 afternoon – Nov 1 (Wave 2) |
| Insight | `backend/halo/insight/` | W1 | Oct 31 afternoon – Nov 1 (Wave 2) |
| Hub + Capture (incl. extension composition root) | `extension/src/hub_capture/` | W3 | Nov 1 (Wave 3: rig → hub → overlay in Frame mode → face detector) |
| Setup Panel (incl. pairing UI) | `extension/src/setup_panel/` | W2 | Oct 31 afternoon – Nov 1 (Wave 3) |
| Meet Adapter | `extension/src/meet_adapter/` | W2 | Oct 31 afternoon – Nov 1 (Wave 3) |
| Frame Source | `extension/src/frame_source/` | W2 | Oct 31 afternoon – Nov 1 (Wave 3) |
| Face Detector | `extension/src/face_detector/` | W3 | Nov 1 late, or Nov 2 morning (Face mode is a Nov 2 goal; the thin run needs no Face Detector) |
| Overlay | `extension/src/overlay/` | W3 | Nov 1 (Wave 3, Frame mode first for the thin run) |
| Fake Meet + Playwright harness (L3) | `rig/fake_meet/` | W3 | Oct 31, lands by Oct 31 night (Wave 1) |
| Fake engines (FakeASR, FakeLLM) | `rig/fakes/` | W3 | Oct 31, lands by Oct 31 night (Wave 1) |
| Replayer + Golden asserts + fixtures | `rig/replayer/` | W3 | Oct 31, lands by Oct 31 night (Wave 1) |
| Classifier | `backend/halo/classifier/` | W1 | Nov 2 (Wave 4, ring 2, first ring-2 cut) |
| Notes Builder | `backend/halo/notes_builder/` | W1 | Nov 2 (Wave 4, ring 2) |
| Notes Service | `backend/halo/notes_service/` | W1 | Nov 2 (Wave 4, ring 2) |
| Notes page | `notes-page/` | W2 | Starts as soon as `setup_panel`, `meet_adapter`, `frame_source` merge (likely Nov 1), against the golden page JSON; ring 2. Urgency-mark render: Nov 2, after Karim picks a draft |
| Recorder | `backend/halo/recorder/` | W1 | Nov 2 (Wave 4, ring 2) |
| Packaging (README, install steps, release checks) | `packaging/` | W1 | Nov 2 (Wave 5 prep). `backend/halo/app.py` itself is created in Wave 0 (Oct 31) — see Build order |

No PLAN.md: external API boxes (Voice, Spark Open, contributor — wrapped by Transcriber and `llm`), the SAM 3.1 stretch box. `bus` and `llm` have no diagram box; DECISIONS §3 defines them, so they get PLAN.md files. Pairing: backend side in Gateway, UI side in Setup Panel.

## Dependencies

Every backend envelope travels as a Bus topic by `type`. No module imports another module's code. The only file that imports every module is the composition root `backend/halo/app.py`; import-linter allows that file only. `app.py` is **not** a Nov 2 deliverable: Wave 0 creates it (Bus + FastAPI app + `uv run halo`, Oct 31) because L2 replay and the thin run boot the real backend, and each W1 backend module PR then adds its own wiring lines to it — an allowed exception to the lane rule (same window, sequential PRs). Packaging's Nov 2 job is the README, install steps and release checks that ship that entry point.

Three named exceptions to envelope-over-Bus, all wired in `app.py`: (a) bounded `asyncio.Queue`s (audio tab, audio mic, rec) — Gateway produces, Transcriber/Recorder consume, no envelope; (b) Notes Builder and Notes Service read the Event Store SQLite read-only (schema + views are a contract documented in the Event Store PLAN); (c) health — each module registers `bus.register_health(name, fn)`; the Gateway calls `bus.health()`. One FastAPI app on `127.0.0.1:8765`: Gateway owns `/ws`, `/pair`, Host/Origin middleware; Notes Service owns an `APIRouter` for `/notes/*` and `/api/*`; `app.py` mounts both.

Build-blocking dependencies: `contracts` → everything. Lean rig (Wave 1) → Wave 2 and Wave 3 tests. `bus` + `llm` → every backend consumer. Event Store views (`points_current`, `tags_effective`) → Notes Builder, Notes Service. Golden page JSON (`GET /api/meetings/{id}`) in `contracts` → `notes-page` can build before Notes Service lands.

Day-0 probe gates (Karim-run; results in `Planning/day0/<probe>/` outside the repo; Claude records outcomes in DECISIONS §5 — plans point at DECISIONS, never a new file): `meet-overlay` (no `<video>` ⇒ Frame Source + Face Detector emit nothing, every tile Frame mode, Path B stays cut; unreadable tile rects/speaking highlight ⇒ stop, back to Karim — see Meet Adapter PLAN), `spark-latency` (slow/failing ⇒ per-call failover covers it, no plan change), `arabic-asr` (Egyptian + Jordanian speakers; poor ⇒ demo leans English, tune `languageBias`/keywords, no plan change). No probe outcome is a Doubts entry.

## Build order

1. **Wave 0 — Oct 31 morning (W1):** `contracts` + root scaffolding (`pyproject.toml`, `extension/package.json`, CI, PR template, `.gitignore`, `.env.example`) **plus `backend/halo/app.py`** (Bus + FastAPI app skeleton, so `uv run halo` already boots). `wxt.config.ts` + the manifest belong to `hub_capture` (extension composition root), not Packaging. Merges only when L0 is green.
2. **Wave 1 — Oct 31, by night (W3):** lean rig first: one synthetic fixture, FakeASR + FakeLLM, Fake Meet page, Replayer modes A/B + Golden asserts. Other windows test against it.
3. **Waves 2+3 — Oct 31 afternoon – Nov 1:** backend critical path (W1) and extension critical path (W2+W3) in parallel, each gated by its per-wave tests (L2 Mode A golden; L3 Mode B Playwright). Inside W3 the order is fixed: rig (Oct 31 night) → `hub_capture` → `overlay` in Frame mode → `face_detector` (Nov 1 late, or Nov 2 morning).
4. **Thin end-to-end — Nov 1 night:** the joined run below. W1 + W3 fix what it finds; Claude reviews.
5. **Wave 4 — Nov 2:** Face mode + live Meet; second ring (Classifier, Notes Builder, Notes Service, Notes page, Recorder); Packaging.
6. **Wave 5 — Nov 2 night → Nov 3:** live rehearsal (L5), cut list applied to anything not solid. Nov 3: 3-minute demo video, final README, submit. Official deadline Nov 4, 9 PM ET; we finish a day early.

One module per git worktree. Branch `module/<module>`. PRs merge on green CI (DECISIONS §7).

## Thin end-to-end milestone (Nov 1 night, Replay rig, Frame mode)

The two halves are per-wave gates and must be green first; neither counts as the milestone alone: L2 (Replayer Mode A golden through the real backend) and L3 (Playwright Mode B on the Fake Meet page). The milestone is **one joined run**:

1. Playwright loads the real extension and opens the Fake Meet page, which plays the synthetic fixture's audio and paints its tiles.
2. The hub starts capture through the test-only `?halo_test=1` hook (Playwright cannot click the toolbar).
3. The real extension holds the one socket to the real backend (`uv run halo` with fakes on via env, e.g. `HALO_FAKES=1`). FakeASR emits the fixture's canned transcripts aligned to the audio frame `ts_ms`; FakeLLM returns canned points.
4. **Pass:** the bubble appears on the right tile within the latency budget (~3 s typical, p90 under 4 s from pause to point), and `events.sqlite` matches the golden (`expected.jsonl`: ts ±300 ms, fuzzy text, ids ignored, order per tile).

Frame mode only: no Face Detector in this run. Optional the same night, not a gate: the same run on real Voice + Spark Open, if the keys are in `.env`.

## Integration order

Demo dies if any critical-path link fails, so integrate in this order: Hub Capture → Gateway → Transcriber → Correlator → Insight → Gateway → Overlay, plus Meet Adapter (tiles, names, speaking highlight) → Frame Source → Face Detector → Overlay. First on the Replay rig (thin milestone), then Face mode, then live Meet. Then the second ring in dependency order: Event Store views → Notes Builder → Notes Service → Notes page; Classifier any time after Insight (it never gates a point); Recorder with the Notes link check (point → transcript line → recording moment). L4 (Karim's 2–3 OBS-recorded bilingual calls, local only, one frozen real-engine run, never committed) tunes Correlator knobs and spot-checks Arabic. L5 is the Nov 2 night live rehearsal.

## Cut list (DECISIONS §8, in this order)

✂1 SAM 3.1 stretch · ✂2 Zoom/Teams adapters (`meet_adapter`) · ✂3 Recorder video — keep transcript links, drop video (`recorder`; Hub stops sending `kind=3`) · ✂4 Notes Builder per-person depth — keep live points + action list (`notes_builder`, `notes-page`) · ✂5 re-tag menu (`notes-page`; Notes Service still stores `tags.set`) · ✂6 Arabic UI polish beyond RTL correctness (`overlay`, `notes-page`). Never cut: consent badge, the critical path, contract validation. Module-local post-MVP notes (e.g. points moving to the share surface) are not new ✂ numbers. The Classifier is the first ring-2 cut inside ring 2.

## How to run every test

One uv project: `pyproject.toml` at the repo root covers `backend/halo` and the Python parts of `rig/`. Run everything from the repo root. CI runs L0–L3 only: no keys, no GPU, no network.

| Level | What | Command |
|---|---|---|
| Start backend | composition root, prints pairing code | `uv run halo` |
| All Python tests | contracts + backend + rig | `uv run pytest` |
| L0 contracts | schemas, golden samples, codegen drift, binary headers (contracts ships the ACK test kit; gateway/hub/event_store run it in their own tests) | `uv run pytest contracts -q` and `uv run python -m contracts.codegen --check` |
| L1 one backend module | unit tests with fakes (`backend/halo/<module>/tests/` inside the lane) | `uv run pytest backend/halo/<module> -q` |
| L2 Replay golden | Replayer Mode A → real backend vs `expected.jsonl` | `uv run pytest rig/replayer/tests/test_replay_golden.py -q` |
| Extension units | Vitest in `extension/src/<module>/` | `npm --prefix extension test` |
| Extension types | `tsc --noEmit` | `npm --prefix extension run typecheck` |
| L3 Playwright | Fake Meet + real extension, Mode B; new headless Chromium (loads extensions) | `npm --prefix rig/fake_meet test` |
| Thin joined run | real extension + Fake Meet + real backend with fakes | `HALO_FAKES=1 uv run halo` in one shell; `npm --prefix rig/fake_meet run test:joined` in another |
| Notes page render | one Playwright render against the golden page JSON | `npm --prefix notes-page test` |
| Lint (blocking) | Python lint + import-linter lanes | `uv run ruff check .` and `uv run lint-imports` |
| Types (report only) | mypy, non-blocking | `uv run mypy backend/halo` |
| L4 real-engine smoke | Karim's recorded calls, frozen, local only | on demand, capped; never in CI, never committed |
| L5 live Meet rehearsal | real call | Nov 2 night, Karim |

Codegen (one command, from `contracts`): `uv run python -m contracts.codegen` regenerates pydantic (backend) + TS types (extension); `--check` fails on drift.

## CI checks (GitHub Actions, every PR)

Blocking from Wave 0: L0 contract validation + codegen drift check, L1 unit tests, `ruff check`, `tsc`, import-linter lanes. L2 and L3 become blocking the day their first test lands; until then the job is a skipped placeholder. `mypy` runs report-only. A wave merges only when its offline tests are green in CI. `main` is protected; Claude reviews `/contracts` and critical-path PRs.

Data: everything lives in `data/` at the repo root (git-ignored, override `HALO_DATA_DIR`). No delete UI in the MVP; deleting that folder wipes everything. Per-meeting delete is post-MVP.

## Contract coverage table

Every event type and binary frame kind in the diagram. ACK only on the extension⇄Gateway socket; inside the backend `bus.publish()` returns a typed Ack at once. The Event Store taps every accepted envelope, so it is a consumer of every bus row even where the named consumers are the point.

| Type / kind | Emitter | Consumer(s) |
|---|---|---|
| `pair.hello` `{token, ext_version}` (envelope, `meetingid` null allowed — `pair.*` only) | Hub (`hub_capture`, first message on every socket connect) | Gateway (reply `pair.ok`/`pair.rejected` is its ACK) |
| `pair.ok` `{session_id}` | Gateway | Hub (then extension-local session state) |
| `pair.rejected` | Gateway | Hub (Setup Panel shows re-pair) |
| `meeting.started` `{meeting_id, platform, meeting_code, t0_ms, self_name}` | Hub (mints `meeting_id` at Start) | Gateway → Bus: Correlator, Event Store (creates `meetings` row), Notes Builder (arms once-per-meeting guard) |
| `meeting.ended` `{reason: left\|tab_closed\|timeout}` | Hub (leave, tab close, Stop); Gateway only on 60 s dead socket with no hub `meeting.ended` (reason `timeout`, different id) | Transcriber (close Voice sessions), Notes Builder, Recorder (finalize) — each acts once per `meeting_id`, first wins, later ignored |
| `system.status` `{asr, llm:{engine, failover}, tagger}` (global, `meetingid` null; no `outbox_backlog` — the hub shows its own backlog in the Overlay status chip, extension-local) | Gateway (from `bus.health()`, every 5 s and on change) | Overlay (status chip); Event Store tap |
| `meeting.context` `{subject, agenda[], roles[{name, role?}], viewer_lang, project_id?}` | Setup Panel (via hub socket, ⇄ ACK; later language changes: Overlay → Port `set_viewer_lang` → hub re-sends its latest context with the new `viewer_lang`; late/re-sent context applies to later turns only) | Gateway → Bus: Insight (latest wins), Event Store (`meetings.subject/project_id`) |
| `tiles.snapshot` `{tiles:[{tile_id, name, is_self, rect, video_w, video_h, fit, captions_rect}]}` | Meet Adapter | In-tab: Overlay, Frame Source (no socket copy). Via Port → Hub → socket (⇄ ACK) → Gateway → Bus: Correlator, Event Store |
| `speaker.active` `{tile_id, speaking, ts_ms}` | Meet Adapter | In-tab: Overlay (speaking glow + thinking trigger). Via Port → Hub → socket (⇄ ACK) → Gateway → Bus: Correlator, Event Store |
| `transcript.final` `{turn_id, stream, speaker, text, lang, ts_start_ms, ts_end_ms}` (finals only) | Transcriber | Correlator; Event Store (FTS source) |
| `turn.attributed` `{turn_id, text, lang, ts_start_ms, ts_end_ms, tile_id, name, attribution, overlap}` | Correlator | Insight; Event Store |
| `speaker.mapped` `{speaker, tile_id, name, locked, corrects?}` | Correlator | Insight (re-send, no re-run — see Insight PLAN); Gateway → Overlay; Event Store |
| `points.upsert` `{point_id, tile_id, speaker_name, kind, text, lang, quote, turn_ids[], rank, attribution, urgency?, is_action, engine, replaces?}` (upsert by `point_id`) | Insight | Classifier; Gateway → Overlay (bubble; same id replaces/moves in place; `replaces` removes the old point); Event Store (`points_current`, hides replaced) |
| `llm.health` `{engine, p90_ms}` | Insight (on engine change, else at most every 30 s) | Gateway (feeds `system.status`); Event Store tap |
| `tags.set` `{target, target_id, kind?, urgency?, source, model?}` | Classifier (`source: model`, live only, skips user-tagged targets forever); Notes Service on `POST /api/tags` (`source: user`) | Gateway → Overlay (same merge rule, ignores model after user); Event Store (`tags_effective`); Classifier (skip set) |
| `notes.ready` `{meeting_id, project_id?, url, degraded, people[...]}` (`url` = `/notes/{meeting_id}`) | Notes Builder (once per `meeting_id`, first `meeting.ended` wins) | Event Store (stored); Gateway → Overlay (notes-ready toast). Notes Service does **not** consume it; it reads SQLite per request |
| `TileFrame` `{tile_id, ts_ms, bitmap, frame_w, frame_h}` (in-tab, never sent) | Frame Source | Face Detector |
| `faces.update` `{tile_id, frame_ts_ms, engine, space, face\|null}` (in-tab, engine-agnostic) | Face Detector | Overlay (null ⇒ Frame mode) |
| Port union (`contracts/ext/port.ts`, TS only, no schema, no Port ACK; incl. `set_viewer_lang`) | Meet page modules / Hub | Hub ↔ Setup Panel, Meet Adapter, Overlay (socket-bound payloads keep their envelope types; Overlay ACKs ride the Port back to the Hub; `set_viewer_lang` makes the hub re-send its latest `meeting.context` with the new `viewer_lang`) |
| Binary `kind=1` audio `[1][stream 0=tab,1=mic][seq u32][ts_ms u64]` + PCM16 16 kHz 100 ms (no envelope, no ACK; `kind=2` reserved, reject) | Hub Capture | Gateway data side → bounded queue → Transcriber |
| Binary `kind=3` rec `[3][seq u32][ts_ms u64]` + webm (no envelope, no ACK) | Hub Capture (Recorder switch only starts/stops sending) | Gateway data side → bounded queue → Recorder |

Non-events (owner only, no envelope): `recording` file index — owner Recorder, read by Notes Service (recording offset = `ts_start_ms − start ts_ms of the covering recording file`). Search hit — owner Notes Service, served as HTTP JSON. `events` SQLite schema + views `points_current`/`tags_effective` — owner Event Store, read read-only by Notes Builder and Notes Service.

HTTP (JSON, no envelope; one app, `127.0.0.1:8765`): Gateway owns `GET/POST /pair`, `/ws`, Host/Origin middleware. Notes Service owns `GET /notes/{meeting_id}` (same shell for every meeting; the shell fetches JSON), `GET /api/meetings/{meeting_id}` (meeting + people + points + actions with merged tags + transcript lines + recording offsets), `GET /api/meetings?project_id=`, `GET /api/search?q=`, `GET /api/meetings/{id}/export.md`, `POST /api/tags` (same field names as `tags.set`).

### Diagram arrows not placed as contracts

None unplaced (62 edges total). Full inventory, grouped by where each is placed: waves `s01 s12 s13 s24 s34 s45` (build order above); grey type joins `p_notespage p_c_ack p_c_plane p_c_cat p_c_clk p_c_kit p_setup p_cap p_adp p_frm p_det p_tr p_co p_ins p_cls p_nb p_es p_ns p_rec p_fcap` (type owned by its module's PLAN); in-tab `adp_frm frm_det det_ovl adp_ovl` (rows `tiles.snapshot`/`TileFrame`/`faces.update`); socket + HTTP `e_setup e_cap e_adp e_ovl e_http` (coverage rows + HTTP table); backend bus/data `g_tr g_co g_ins ins_g cls_g g_es g_ns g_rec tr_co co_ins ins_cls es_nb nb_es es_ns rec_ns` (coverage rows; `es_nb`/`es_ns`/`rec_ns` are the read-only SQLite/view reads, `g_tr`/`g_rec` the bounded queues); model APIs `tr_voice ins_open cls_c nb_13 fail` (wrapped by Transcriber/`llm`; failover in `llm` + Insight); rig `pw_fm fm_ext rp_chk fcap_rp rp_gw rp_fm f_api` (Fake Meet/Replayer/fakes PLANs; `f_api` is the `HALO_FAKES` drop-in switch). External API boxes and the SAM stretch have no PLAN.md (DECISIONS §3).


