# Halo: decisions (single source of truth)

Every agent (Muse, OpenCode, any Claude account) reads this first. If another doc disagrees with this file, this file wins. The build plan is `docs/PLAN.md` (master) plus one `PLAN.md` per module.

## 1. Product (locked)

- **Halo**: a bilingual Arabic/English Google Meet copilot. Chrome extension + local Python backend on the user's PC. **Open source (MIT). Nothing is hosted**; no logins, no cloud backend.
- **Face mode is the core.** The person's **name floats above their head: the name is the halo** (no rings, arcs or crowns). Up to 3 points beside the face as transparent glass speech bubbles with a tail toward the face, kind-tagged: point, question, decision, pushback. Frame mode (points inside the tile) when no face is found or for tiles beyond 6.
- Points show in the viewer's language (default English); the original quote is one click away. Points fade after ~60 s; corrections replace a point in place (same id).
- **Notes app** (served by the backend at 127.0.0.1): meetings list + search; meeting page with clickable avatars; per person: why they matter (role), relevant points, own points, action items. Every point links to its transcript line and recording moment. Markdown export.
- Categories: Decision, Open question, Pushback, Point. **Action items grouped by urgency: Urgent, Medium, Later / to discuss.** Assigned (said aloud) vs suggested (by role). Labels come from a low-cost model; the user can re-tag in one click.
- Retention: notes, transcripts, logs **and recordings** are local files on the user's PC, kept until the user deletes them (Karim, 2026-10-30; an optional cloud upload via an API comes later). Consent: user-controlled Meet chat notice + visible badge. Every demo participant consents; demo scenes and content are made up.
- **Headset required** for anyone running Halo (otherwise the mic re-captures the call: echo). Crosstalk: a turn with two speakers is marked `overlap` and stays provisional; the demo script avoids crosstalk (no off-the-shelf fix exists in this stack).
- Latency target: ~3 s typical, p90 under 4 s from a speaker's pause to the point.

## 2. UI source of truth (locked 2026-10-30)

- **Overlay:** `docs/ui/overlay-mix-b.html` ("Mix B, black borders"): Smoked Glass layout + Aurora per-person hue; coloured kind icons (sky point, lilac question, mint decision, peach pushback) with a 1.5px black ring.
- **Notes page:** `docs/ui/notes-v2.html?palette=2` ("People First" layout, palette "Sage & Clay").
- Overlay rules: `docs/ui/OVERLAY-UX.md` (its halo-ring rules are superseded by section 1 above). Build from the two files above, not from older drafts.

## 3. Architecture (v2, final)

- Two processes: **(1) WXT/TypeScript extension** (Setup Panel, Hub + Tab/Mic Capture, Meet Adapter, Frame Source, Face Detector, Overlay), one WebSocket to the backend held by the hub (the offscreen doc), no API keys; **(2) one FastAPI modular-monolith backend** (Bus, LLM client, Gateway, Transcriber, Correlator, Insight, Classifier, Notes Builder, Notes Service, Recorder, Event Store) on an in-process asyncio EventBus interface, SQLite + FTS5 + local files.
- **Meta-only runtime rule (hackathon organisers, 2026-10-31):** every AI model Halo calls at runtime must be a Meta model, even one run locally; the README lists which Meta models run where. MediaPipe/BlazeFace and YuNet are not Meta models, so **Frame mode ships first** (it is what runs today: `meet.content.ts` never mounts the face-detector iframe). **Halo mode (name above the head) comes second, on SAM 3.1** (Meta) for the speaking tile, measured at 7.1 tile-frames/s and 3.8 GB VRAM on the 3080 Ti. SAM cannot run in the browser, so that design (still open) must send speaking-tile frames to a local process, an exception to "video frames never leave the browser" below. Karim, 2026-10-31.
- **Face tracking (2026-10-30, engine superseded by the rule above):** a small in-browser face detector (MediaPipe Face Detector or YuNet) inside the extension, about 1-2 ms per tile. **Video frames never leave the browser.** It emits `faces.update`; the contract is engine-agnostic so SAM 3.1 can plug in later. SAM 3.1 is a stretch goal only. No VLM for faces; no Gemini in the product.
- Frame source: read each tile's `<video>` directly. If Meet exposes none (Karim's day-0 meet-overlay probe decides), there is no face tracking: every tile uses Frame mode. **Path B (crop from the tab capture) is cut** (Karim, 2026-10-30): Chrome cannot hand a video track from the capture page to the Meet page.
- **Diagram:** `docs/architecture/halo-v2-final.drawio` (open `halo-v2-final.html` next to it for a zoomable view). Boxes = module jobs, arrows = contracts (⇄ ACK on the socket), grey boxes = JSON types.
- **Two support modules with no box of their own in the diagram:** `backend/halo/bus` = the in-process asyncio EventBus (`publish(envelope)` validates against `/contracts` and returns a typed Ack at once; `subscribe(type)`; the Event Store tap; `health()`; no retries). `backend/halo/llm` = the one shared model client used by Insight, Classifier and Notes Builder (OpenAI-compatible calls to Baseten and the Meta API, schema validation, retry once, per-call failover, `engine` on every result; rules in `.agents/skills/meta-model-api/llm.md`). External API boxes (Voice, Spark Open, contributor) and the SAM stretch box get no PLAN.md: Transcriber wraps Voice, `llm` wraps the LLMs, the fakes live in `rig/fakes`.
- Not used: Redis, WSL, Pipecat, LangGraph, a GPU worker (unless the SAM stretch happens).
- **Engineering defaults (2026-10-30, from Chrome/MediaPipe docs):** Face Detector = MediaPipe (`@mediapipe/tasks-vision`), WASM + model bundled in the extension (MV3 forbids remote code). It runs in a Worker inside a hidden extension iframe on the Meet page; the content script transfers ImageBitmaps to it. The hub (offscreen doc) holds the WebSocket, mints `meeting_id` (UUID) at Start and sends `meeting.started`; Meet-page modules reach it over a `chrome.runtime` Port. The overlay builds DOM with `textContent` only (Meet enforces Trusted Types) and flips x on the mirrored self tile. The Correlator has a `lag_ms` knob (Meet's speaking highlight trails audio by ~0.3-1 s). The manifest `key` is pinned so the extension id (checked by the Gateway) never changes; the Gateway's HTTP checks the Host header. The recording mixes in the user's mic. Capture starts from the toolbar popup (Chrome needs a user gesture for tabCapture); the offscreen doc replays tab audio through an AudioContext so the user still hears the call; the mic is captured in the Meet tab's content script under meet.google.com's own mic permission (no prompt, no extra page; 2026-10-31) and relayed to the hub as stream 1.
- **Pairing:** Origin check (extension id) + a one-time 6-digit code from 127.0.0.1/pair.
- **Repo + tooling:** one public repo (`contracts/`, `backend/`, `extension/`, `rig/`, `docs/`). Backend: Python 3.12 + uv; `uv run halo` starts it on `127.0.0.1:8765` and prints the pairing code. Extension: WXT + npm. Keys only in `.env` (git-ignored; `.env.example` lists them).

## 4. Contracts (Sergio's rule: contracts first)

- Every JSON message is a CloudEvents 1.0 envelope (`id, type, source, time, meetingid, data`). Raw audio and recording chunks are binary, with no envelope and no ACK.
- **ACK lives on the socket only** (extension ⇄ Gateway, the one place a message can get lost; Karim chose this 2026-10-30, saving ~8-10 agent-hours): ACK (`ack_of, status: ok|error, error?`) = validated, deduped, on the bus. The hub resends the same `id` after 2 s without an ACK or after a reconnect; the Gateway and Overlay dedupe by `id`. Inside the backend, `bus.publish()` returns a typed Ack at once (same schema, no retries, no chaos kit). `meeting.ended` on a dead socket only after a 60 s grace.
- One clock: audio frames carry the browser timestamp; the Transcriber maps ASR offsets onto it.
- Schemas live in `/contracts` (one JSON Schema per type + a markdown catalog: type → emitter → consumers); pydantic and TS types are generated from them. Model outputs are always validated against the schema (Spark Open on Baseten does not enforce `json_schema`).
- The Correlator emits `turn.attributed` (final turn text + tile + name + attribution + overlap); Insight consumes it. Transcripts are finals only. One kind vocabulary everywhere: `point|question|decision|pushback` (the Notes page shows `question` as "Open question").
- Future-proofing, add now: `project_id` (optional) on `meeting.context`; the Meet Adapter implements a platform-neutral `MeetingAdapter` interface; `faces.update` is engine-agnostic.

## 5. Engines and models

| Job | Engine |
|---|---|
| Speech to text | Muse Voice Transcribe realtime: tab session = DIARIZATION, mic session = ENDPOINTING ("you") |
| Live Insight | Spark Open on Baseten (`reasoning_effort` low); **per-call** failover to `muse-spark-1.3-contributor` when a call takes over 4 s, its JSON fails twice, or Baseten rate-limits (HTTP 429); after 30 s the next call tries Spark Open again, and every point records its `engine`. Insight is capped at 30 RPM (Karim, 2026-11-01: the earlier 12 RPM only fit Baseten's basic tier; no Baseten key is in use, the contributor allows 150 RPM). Spark Open on Baseten is Halo's entry for the $10k "Best Build on Meta Open Weight Models" prize, so it stays the default. Each point carries a first-guess `urgency` + `is_action` (same call, no extra latency). |
| Urgency/category tagging (Classifier) | **`muse-spark-1.3-contributor`**. **Live only:** every 10 s, one batched call if new points arrived; corrects Insight's guess in place. Action items are tagged by the Notes Builder (no race with `notes.ready`). User re-tag always wins. Kept by Karim; it is the first ring-2 cut. $0.10 in / $0.002 cached / $0.20 out per 1M tokens, 150 RPM. |
| Notes Builder | **`muse-spark-1.3-contributor`**, once per meeting, schema enforced; outputs each action item's owner, assigned/suggested and urgency |
| Contributor rule (Karim, 2026-10-30) | Every Spark 1.3 call uses the contributor model. Meta training on the content is fine: Halo is open source and demo meetings hold no real data. The consent badge still says it. |
| Measured (day-0 probe, 2026-10-30) | Spark 1.3 at `minimal`, Insight-shaped prompt, 20 calls: total p50 2.74 s, p90 3.62 s, max 3.71 s, 0 errors, 100% valid JSON, prompt cache hits ~91%. PASS. Spark Open on Baseten not measured yet (new key pending). End to end adds ASR finalisation (~1 s): expect ~3.7 s typical, ~4.5 s p90. |
| Faces | Frame mode now; Halo mode on SAM 3.1 (Meta) next. No non-Meta face model (section 3, Meta-only rule) |
| Rules for calling Meta models | `.agents/skills/meta-model-api/` |

## 6. Budgets (who pays for what)

| Budget | Use |
|---|---|
| Muse Code subscription (membership) | W1: bulk backend modules. Main coding budget. |
| Baseten $100 | Runtime Insight only (Spark Open, the open-weights prize entry). W2 moved off Baseten on 2026-10-30, so coding never competes with Insight for the 15 RPM limit. |
| Meta API free credit ($148) | W3: Muse + Wonder for hard modules (about $100 cap), runtime Voice + Spark (rest). **Any Muse window that runs Spark 1.3 on the API key uses `muse-spark-1.3-contributor`** (about 12-21x cheaper; the code is open source anyway). The product's runtime Spark 1.3 calls use it too (section 5). Pass the key per run; never store it. Free credits mean Meta may use the content: tell test-call participants. |
| Modal $30 | optional: only for the SAM 3.1 stretch. Never leave a GPU warm. |
| Gemini | research only, never in the product |
| Claude (any account) | plans, contracts review, PR review, integration. Not bulk coding. |

### Windows (2026-10-30): one TUIOS window, one pane per agent

TUIOS 0.11.1 (Sergio's agent multiplexer) is installed at `%LOCALAPPDATA%\Programs\tuios` and on the user PATH. Claude stays in the Claude desktop app.

| Phase | Panes open | Who codes |
|---|---|---|
| Wave 0 (`/contracts` + PLAN.md files) | 2: W1 + a shell | W1 only. Everything depends on the contracts, so nothing else codes yet. |
| Waves 1-3 (parallel) | 4: W1, W2, W3 + a shell | **W1** Muse (subscription): Wave 0 contracts + CI + PR template, then bus, llm, Gateway (incl. backend pairing), Event Store, Transcriber, Correlator, Insight; Nov 2: Classifier, Notes Builder, Notes Service, Recorder, packaging. **W2** Muse on the Meta API key (`--model muse-spark-1.3 --contributor-mode on`, key loaded from `.env` into that tab only; OpenCode + `opencode.json` is the backup): Setup Panel (incl. pairing UI), Meet Adapter, Frame Source, Notes page. **W3** Muse + Wonder (key per run, `--contributor-mode on`): lean test rig first, then Hub + Capture, Face Detector, Overlay (the hardest browser modules go to the strongest agent). |
| Integration | 2-3 | W1 + W3 fix what the Replay rig finds; Claude reviews. |

At most 3 coding agents at once, one module per git worktree. Each window runs one agent by default; Muse helpers (cap 3) only when a module is clearly split. Waves are "Wave n"; W1-W3 always means a window. This table is the only owner map.

## 7. How we build (Sergio's workflow)

1. Diagram (draw.io): boxes = what the module does; arrows = the contract (with ACK); JSON types in grey boxes joined by plain lines.
2. The diagram XML goes to Muse, which writes a master `PLAN.md` and one `PLAN.md` per module, asking Karim about every doubt. Claude reviews the plans.
3. One repo (never one repo per module: `/contracts` must stay shared), one git worktree per agent, built in waves. Agents raise needs to other modules as GitHub issues (`module:<name>` labels, rules in `AGENTS.md` "Module lanes"; Karim, 2026-10-30, replaces the earlier "no tickets" call). Wave 0 = `/contracts`. Then a **lean test rig** (Fake Meet page, FakeASR + FakeLLM, Replayer with one fixture; checks are plain test asserts) built **in parallel** with the first module waves, then integration. CI golden = a committed synthetic fixture. Karim's 2-3 recorded bilingual calls (OBS: screen + separate desktop and mic tracks) stay local: one real-engine run on them is frozen and spot-checked by Karim (L4, never committed). L3 opens the hub with a test-only `?halo_test=1` hook (Playwright can't click the toolbar); the Face Detector is tested on CC0 photo faces.
4. Each module is built with the `build-module` skill; its tests are the done-criterion. CI on every PR: tests, contract checks, import-linter lanes. **PRs merge on green CI** (Karim, 2026-10-30); Claude reviews `/contracts` and critical-path PRs. `main` is protected. OpenCode (W2) follows `.agents/skills/build-module/SKILL.md` as its instructions.
5. Design work: Karim picks from drafts before anything is built.

## 8. Integration: critical path and cut lines

**Deadline: submit Nov 3 (Karim).** The official deadline is Nov 4, 9 PM ET; we finish a day early. The submission is a public repo + a 3-minute demo video. No X post (no account).

| Day | Goal |
|---|---|
| Oct 30 (tonight) | Diagram final, repo skeleton, Muse writes PLAN.md files; Karim runs the 3 day-0 probes |
| Oct 31 | Morning: `/contracts` (W1 only). Afternoon: W1/W2/W3 in parallel; W3 builds the lean rig first. Karim records 2-3 test calls |
| Nov 1 | **Thin end-to-end by night** on the Replay rig: audio → transcript → point → bubble (Frame mode) |
| Nov 2 | Face mode + live Meet; Event Store, Notes page, Classifier, Notes Builder, Recorder. Night: live rehearsal; **apply the cut list** to anything not solid; packaging (README install steps + one `halo` command that starts the backend and prints the pairing code) |
| Nov 3 | Record the demo video, final README, submit |

**Waves vs rings:** waves are the build schedule (when); rings are the cut priority (what goes first if time runs out). Wave 2 (Oct 31-Nov 1): bus, llm, Gateway, Event Store, Transcriber, Correlator, Insight. Event Store is built in Wave 2 because the replay tests read `events.sqlite`, even though its search depth is ring 2. Wave 4 (Nov 2): Classifier, Notes Builder, Notes Service, Notes page, Recorder, packaging. Cut order is the list below.

**Critical path (the demo dies if any link fails):** Tab + Mic Capture -> Gateway -> Transcriber -> Correlator -> Insight -> Gateway -> Overlay, plus Meet Adapter (tiles, names, speaking highlight) and the Face Detector. Integrate and demo this chain end to end first, on the Replay rig, then live.

**Second ring:** Event Store, Notes Service + Notes page, Setup Panel, Classifier (urgency/category).

**Cut lines, in this order if time runs out:** (1) SAM 3.1 stretch, (2) Zoom/Teams adapters, (3) Recorder (keep transcript links, drop video), (4) Notes Builder per-person depth (keep live points + action list), (5) re-tag menu, (6) Arabic UI polish beyond RTL correctness. Never cut: consent badge, the critical path, contract validation.

## 9. Feature roadmap (after the MVP, in order)

1. **Recall per project:** a local retrieval system (RAG) over transcripts, points, notes and documents, scoped by `project_id`. Ask "what did we decide about pricing across the last 3 meetings?" and Spark answers with links back to transcript lines. Builds on the Event Store + FTS5, adding local embeddings.
2. **Zoom and Teams web clients:** new `MeetingAdapter`s for the browser versions (app.zoom.us, teams.microsoft.com). Audio capture already works for any tab. Desktop apps are out of reach of a Chrome extension.
3. Spark 1.3 reads the shared slide during screen share, as context for Insight.
4. SAM 3.1 visual stretch (the name tucks behind the head).
5. Optional cloud upload of recordings and notes through an API.
6. Per-speaker audio from Meet's 3 loudest-speaker WebRTC tracks, to fix crosstalk at the source.

## 10. Planning answers (P1, 2026-10-30; Muse's doubts 1-24, Karim + Claude)

Recorded in the module PLAN.md files they affect; the short list here wins if a plan drifts.

- **Pairing:** code -> token over plain HTTP `POST /pair`. On every socket connect the hub's first envelope is `pair.hello` (meetingid null allowed); `pair.ok` / `pair.rejected` is its ACK.
- **meeting.ended:** two emitters. The hub is the emitter of record; the Gateway sends `reason: timeout` after 60 s with no socket. Every consumer acts once per meeting_id, and the first one wins.
- **Tiles:** the Meet Adapter emits `tiles.snapshot` + `speaker.active`. It hands them directly to the Overlay and Frame Source in the tab, and sends them via the Port -> hub -> socket to the Correlator. `tiles.snapshot` carries an optional `captions_rect` (the Overlay's floor).
- **Field defaults:** urgency `urgent|medium|later`; viewer_lang `en|ar`; turn lang `ar|en|mixed`; attribution `provisional|locked`; rank int 1-3 (the only rank source); ids are UUID strings; times are integer ms on the browser clock. meetingid is required except on `pair.*`, `system.status` and `llm.health`.
- **Binary frames:** little-endian. kind=1 audio, kind=3 rec (webm, on the wire to the Recorder); kind=2 is reserved and rejected. Face frames never leave the tab.
- **ACK errors** (closed set): `invalid_schema|unknown_type|unpaired|internal`. A duplicate id gets `ok` and is not re-published.
- **Backend wiring:** every envelope travels as a bus topic, and no module imports another. The only exception is `backend/halo/app.py` (owned by packaging), the composition root: it wires the modules, creates the binary queues (Gateway -> Transcriber / Recorder) and mounts the routers.
  - Health: modules call `bus.register_health(name, fn)`; the Gateway builds `system.status` (asr, llm, tagger; no outbox field) every 5 s and on change.
  - Insight emits `llm.health` when the engine changes, at most once every 30 s otherwise.
- **HTTP:** one FastAPI app on 127.0.0.1:8765. The Gateway owns `/ws`, `/pair` and the Host + Origin checks; Notes Service owns `/notes/*` + `/api/*`.
  - `GET /api/meetings/{id}` returns the page JSON. `POST /api/tags` uses the tags.set fields and publishes `tags.set` (source: user).
  - notes-page is static HTML/CSS/vanilla JS, served by Notes Service, and fetches that JSON.
- **Corrections:** a speaker fix re-upserts the same point_id with the new tile/name and no new model call. `replaces` is only for a new point whose content supersedes an old one.
- **Classifier:** live only, every 10 s. It never touches a target the user has re-tagged. Merge rule everywhere: latest user tag > latest model tag > original guess. The Event Store owns the SQL views `points_current` and `tags_effective`.
- **Notes:** `meeting.ended` -> Notes Builder reads SQLite -> `notes.ready` (url `/notes/{meeting_id}`, plus `degraded: bool`) -> stored, and forwarded to the Overlay toast. If the model fails twice, it falls back to the live points + is_action points as suggested actions.
- **Data:** everything goes in `data/` (git-ignored, `HALO_DATA_DIR`). There is no delete UI in the MVP; delete the folder. The recording link = ts − the start ts of the covering recording file.
- **Correlator constants** (tunable, not contract): lag_ms 500, lock after 3 agreeing turns, echo window 2000 ms.
- **Overlay:**
  - Mix B is the only token source; OVERLAY-UX covers geometry and timing.
  - The badge floats top-left. A presenter's points stay on their camera tile (share surface: post-MVP).
  - Tiles beyond 6 still show pills.
  - Thinking state = a light sweep on the name pill, from speaker.active false until a point lands or 5 s pass.
  - The urgent mark is an open draft item.
- **Extension:** the lane = `extension/src/<module>/`, and WXT entrypoints are thin wrappers in `src/entrypoints/`.
  - hub_capture is the extension's composition root: wxt.config.ts, the manifest, and the Meet content script.
  - The Port protocol is typed in `contracts/ext/port.ts`.
  - Badge-menu settings: the language change re-sends `meeting.context`; the other settings stay in the extension.
- **Repo + CI:** one root `pyproject.toml`; `uv run halo` and `uv run pytest` run from the root. Backend tests live in `backend/halo/<module>/tests/`.
  - Extension: `npm --prefix extension test` / `run typecheck`. Playwright L3: `npm --prefix rig/fake_meet test`.
  - Blocking: contract checks + codegen drift, unit tests, ruff, tsc, import-linter. L2/L3 become blocking once they exist. mypy reports only.
  - Wave 0 creates the root files, and packaging owns them afterwards. Other lanes may only append their own dependencies.
- **Thin milestone (Nov 1 night):** one joined run.
  - Setup: the real extension on the Fake Meet page plays the fixture audio into the real backend, with fakes on (FakeASR + FakeLLM), Frame mode.
  - Pass: the bubble appears on the right tile, and events.sqlite matches the golden.
- **Probe gates:** fallbacks are locked.
  - No `<video>` -> Frame mode everywhere.
  - Unreadable tile rect or speaking highlight -> stop and ask Karim.
  - Slow Spark Open -> failover.
  - Weak Arabic ASR -> the demo leans English.
- **Schedule:** the W3 lean rig is due Oct 31 night. W2 starts notes-page once its three modules are merged.
  - W3 then builds hub_capture -> overlay (Frame mode) -> face_detector.
  - `app.py` starts in Wave 0; each W1 backend PR adds its own wiring lines there.
- **Review fixes (P1 plans, 2026-10-30):**
  - Tab and mic are always separate streams (only the webm recording mixes them).
  - Insight coalesces capped turns into the next call and never drops them.
  - The Correlator never drops a turn: mic -> self tile, locked.
  - Consent = the Overlay's dialog with "Copy notice", and nothing automates Meet chat.
  - Pairing tokens persist in `data/` across backend restarts.
  - Urgency mark (Karim, Oct 31): two styles, switchable by the viewer. **Words** = draft 2 (word tab in the bubble's language; the default) and **Symbols** = draft 1 (shape seals: triangle urgent / circle medium / hollow square later, about 25% smaller than the draft). The setting lives in the setup panel and is stored in `chrome.storage.local` key `halo.urgencyStyle` (`"words"|"symbols"`); the overlay reads it and follows `storage.onChanged` live. No Port or contract change.

## 11. For a new agent session

1. Read this file, then `docs/PLAN.md`, then your module's `PLAN.md`.
2. Karim's working rules: drafts before designs; one agent per task by default (save Claude usage for building); never spend Meta/Baseten credit on design work; keys go in hidden prompts or `.env`, never in chat or files.
