# gateway: PLAN

## Job
Wave 2 (W1, Oct 31 afternoon – Nov 1). The backend's only front door and its only socket. Critical path. Pairing backend side: serves `/pair` (6-digit code → token; plain HTTP before any meeting; the code stays single-use and a new one is printed at each start). Issued tokens survive a backend restart: the backend stores them hashed under the data dir (`data/`, or `HALO_DATA_DIR`), so restarting `uv run halo` never forces a re-pair. Checks Origin = pinned extension id on the socket and Host header on HTTP (127.0.0.1 only). Data side (binary, no ACK): audio by stream → Transcriber queue, rec chunks → Recorder queue. Control side: validates every envelope against `/contracts`, dedupes by `id`, publishes on the Bus, then ACKs — this socket is the only place with ACK + resend. Builds `system.status` from `bus.health()` every 5 s and on change. Synthesizes `meeting.ended` (reason `timeout`) only after 60 s with no socket and no hub `meeting.ended`.

## Inputs (contracts consumed)
Socket: `pair.hello` (first message on every connect; `meetingid` null when no meeting — the reply `pair.ok`/`pair.rejected` is its ACK), then any envelope (⇄ ACK); binary `kind=1` audio and `kind=3` rec chunks (no envelope, no ACK; `kind=2` rejected). Bus: `points.upsert`, `tags.set`, `speaker.mapped`, `system.status` (own), `notes.ready` to forward to the Overlay. HTTP: `POST /pair {code}`, `GET /pair` page.

## Outputs (contracts emitted)
Socket to hub/Overlay: ACK per envelope (`ok` once validated, deduped, on the bus; duplicate id → ACK `ok` again, not re-published), `pair.ok`/`pair.rejected`, forwarded `points.upsert`, `tags.set`, `speaker.mapped`, `notes.ready`, `system.status` `{asr, llm:{engine, failover}, tagger}` (global, `meetingid` null; no `outbox_backlog` — the hub shows its backlog extension-locally). Bus: every accepted socket envelope by `type`. Gateway emits `meeting.ended` only in the timeout case above; consumers act once per `meeting_id`, first wins. Binary out: producer ends of the bounded queues wired in `app.py` (produced here, consumed by Transcriber/Recorder; no envelope, no bus).

## Lane (the files it owns)
`backend/halo/gateway/**` (+ `tests/`). Owns `/ws`, `/pair`, Host/Origin middleware. Does not own `app.py` (Packaging) or the Notes router (Notes Service).

## Depends on
`contracts`, `bus`. Composition (queues, app mounting) wired by `packaging` in `app.py`.

## Fakes it tests with
Replayer Mode A (fake extension: pairs with a test token, honours ACK + resend) for L2; raw socket tests for L0. No model fakes (Gateway calls no model).

## Done = tests
Run: `uv run pytest backend/halo/gateway -q`, executing the ACK test kit shipped by `contracts` (fixtures + expected behaviour) inside this suite. Concrete cases: (1) valid envelope → ACK `ok`, one Bus publish; duplicate id → ACK `ok`, still one publish / one stored row. (2) Dropped ACK scenario: same `id` resent → deduped. (3) Envelope before `pair.ok` → ACK `error/unpaired`; bad schema → `invalid_schema`; unknown type → `unknown_type`; bad token or wrong Origin → `pair.rejected`, socket closed. (4) HTTP to non-127.0.0.1 Host → rejected. (4b) Pair, restart the backend (`uv run halo` again, new code printed), reconnect with the previously issued token → `pair.ok` with no re-pairing; the spent 6-digit code stays spent, and stored token rows are hashes, never plaintext (assert the file contents). (5) Binary `kind=1` lands on the right stream queue in order; `kind=3` on the rec queue; `kind=2` rejected; seq gap → silence pad + gap logged, 30 s bound → `system.status` warn. (6) `system.status` emitted on health change and every 5 s (`asr` from Transcriber, `llm` from Insight, `tagger` from Classifier). (7) No socket + no hub `meeting.ended` for 60 s → exactly one Gateway `meeting.ended` (`timeout`).

## Cut line
Never cut (critical path; consent-adjacent pairing stays). Nothing in this module is ring 2.

## Doubts
Answered: pairing handshake, duplicate rule, `meeting.ended` dual emitter with first-wins consumers, `outbox_backlog` dropped (batches 1, 5). Answered (review): pairing survives a backend restart — issued tokens are stored hashed in the data dir; the 6-digit code stays single-use with a fresh code printed at each start.
