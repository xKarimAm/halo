# hub_capture: PLAN

## Job
Wave 3 (W3, Nov 1, after the lean rig). Critical path. The Hub in the offscreen document: opened by Start, mints `meeting_id` (UUID), holds the one WebSocket to the backend for the whole capture, sends `pair.hello` first on every connect, relays Port messages between the socket and the Meet-page modules, keeps the envelope outbox (no ACK in 2 s, or on reconnect → resend the same `id`, 3 tries then status degraded; dedupe by `id`). Tab/Mic Capture: `tabCapture` (others) + mic (you; headset required) as **two separate streams** — stream byte 0 = tab, 1 = mic, each mono 16 kHz PCM16 100 ms frames stamped with browser `ts_ms` (stereo downmixed to mono within each stream only; the streams are never mixed — the Transcriber runs two sessions and the Correlator's echo rule needs them apart). Replays tab audio through an AudioContext so the user still hears the call. Only the webm recording (`kind=3`) mixes tab + mic. Extension composition root: owns the Meet content-script wrapper, `wxt.config.ts`, and the manifest (pinned `key` so the extension id never changes, permissions, `wasm-unsafe-eval` CSP). Other lanes raise `module:hub_capture` issues for changes there.

## Inputs (contracts consumed)
Port union (`contracts/ext/port.ts`): `meeting.context` from Setup Panel, `set_viewer_lang` from the Overlay, `tiles.snapshot`/`speaker.active` from Meet Adapter, Overlay ACKs riding the Port back. Socket from Gateway: ACKs, `pair.ok`/`pair.rejected`, `points.upsert`, `tags.set`, `speaker.mapped`, `system.status`, `notes.ready`. `?halo_test=1` test hook opens the hub with fixture audio (Playwright cannot click the toolbar).

## Outputs (contracts emitted)
Socket: `pair.hello {token, ext_version}` first on every connect; `meeting.started {meeting_id, platform, meeting_code, t0_ms, self_name}` at the Start click; forwarded `meeting.context`, `tiles.snapshot`, `speaker.active` (⇄ ACK, outbox + resend); `meeting.ended {reason}` on leave/tab close/Stop (emitter of record; Gateway timeout is the backstop, consumers act once per meeting). The hub keeps the latest `meeting.context`; on Port `set_viewer_lang` it re-sends that context with the new `viewer_lang` (no new envelope type). Binary `kind=1` audio (streams 0/1 kept apart) and `kind=3` rec chunks (no envelope, no ACK; Recorder switch only starts/stops `kind=3`). Port: backend envelopes fanned out to the Overlay; hub outbox backlog shown in the Overlay status chip (extension-local, over the Port — the Gateway cannot know it).

## Lane (the files it owns)
`extension/src/hub_capture/**` (+ tests in the same folder). Entry wrappers it owns: `extension/src/entrypoints/offscreen/` (boots this module), the Meet content script wrapper (boots `meet_adapter`, `frame_source`, `overlay`), `extension/src/wxt.config.ts`, the manifest.

## Depends on
`contracts` (envelope, binary framing, Port union). Day-0 probes: none directly; `meet-overlay` failure modes land in `meet_adapter`/`frame_source`.

## Fakes it tests with
Replayer Mode B (fake backend on the Fake Meet page), the `?halo_test=1` fixture-audio hook, and the ACK test kit from `contracts` (run here for the resend/dedupe behaviour); Vitest fakes for outbox/dedupe logic.

## Done = tests
Run: `npm --prefix extension test` and L3 `npm --prefix rig/fake_meet test`. Concrete cases (diagram box: `?halo_test=1` opens it with fixture audio): (1) hub opens via `?halo_test=1`, sends `pair.hello` first, then `meeting.started` with a fresh UUID. (2) No ACK in 2 s → same `id` resent; reconnect → outbox resent, receiver sees each `id` once (dedupe). (3) Audio frames: `[kind=1][stream][seq][ts_ms]` little-endian, monotonic `ts_ms`, 100 ms PCM16; a mic-only tone appears on stream 1 and never on stream 0 (and a tab-only tone never on stream 1); tab audio still audible locally (AudioContext replay present). (4) `set_viewer_lang` → exactly one re-sent `meeting.context`, identical except `viewer_lang`. (5) Recorder switch off → `kind=3` stops, audio continues; on → resumes. (6) Tab close/Stop → one `meeting.ended`; hub survives a Meet-page reload for the 60 s grace instead of ending the meeting.

## Cut line
Never cut (critical path; holds the socket). ✂3 touches only its `kind=3` sending, which the Recorder switch already isolates.

## Doubts
Answered: outbox backlog is extension-local; Port is a contracts-owned TS union with no Port ACK (batches 3, 5). Answered (review): tab and mic are never mixed — two separate `kind=1` streams (0 = tab, 1 = mic), each mono 16 kHz PCM16, stereo downmixed within its own stream only; only the `kind=3` webm mixes tab + mic. `set_viewer_lang` (Overlay → hub over the Port) re-sends the hub's latest `meeting.context` with the new language.
