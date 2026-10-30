# gateway: STATE

## Goal
Implement gateway per its PLAN.md; done ONLY when `uv run pytest backend/halo/gateway -q` passes and the contract tests for gateway pass.

## Key decisions
- `PairingStore`: one single-use 6-digit code in memory (fresh per backend start); issued tokens persisted as sha256 hashes in `data/pairing.json` (`HALO_DATA_DIR` overrides). Restart mints a new code; old tokens keep working; the spent code stays spent because only the current code validates.
- `POST /pair {code} -> 200 {token}`; wrong/used code 401; malformed body (not a 6-digit string) 400 — the issue #5 ruling, implemented exactly.
- `SocketSession` (transport-free): pairing gate first (`pair.hello` only), then `unpaired`, `unknown_type`, `invalid_schema` (contracts `validate_envelope`), gateway-global id dedupe (survives reconnects; the Event Store UNIQUE is the second line), then `bus.publish`; the socket ACK mirrors the bus ack. `pair.hello` is answered by a `pair.ok`/`pair.rejected` envelope, never an ACK frame. Real sockets stay a thin loop in the router (no `websockets` test package here; L2 replay covers the wire).
- Origin check is exact-match `chrome-extension://<id>` with the id from `HALO_EXTENSION_ID`; default empty rejects all (closed until hub_capture publishes the pinned id — issue #27).
- `AudioRouter`: kind=1 to the tab/mic queues, kind=3 to rec, kind=2 rejected. Seq gaps are silence-padded (3200 zero bytes = 100 ms @16 kHz mono) capped at 300 frames (30 s bound), then resync; late frames dropped; full queues drop-newest. Items are `(seq, ts_ms, payload)` tuples.
- `system.status` is built from `bus.health()` (missing services read down/unknown), published on the bus (so the Event Store tap sees it) and broadcast to paired sockets every 5 s and on change.
- `meeting.ended` timeout: 60 s after the last socket drops with no hub `meeting.ended` on the bus, exactly one `reason: timeout` envelope per meeting (new id) via `bus.publish`.
- No schema slot exists in `system.status` for an audio-gap warn, so gaps surface as logs + the gateway health counters, not in the status payload (noted for Karim in the PR).
- `app.py` keeps only mechanical mount lines (construct `Gateway`, `include_router`, register host middleware); all logic moved here.

## Task graph
1. [x] `pairing.py` + restart-persistence tests (PLAN 4b)
2. [x] `session.py` + contracts ACK-kit tests (PLAN 1-3)
3. [x] `audio.py` + routing/gap tests (PLAN 5)
4. [x] `gateway.py` (router, Host/Origin, status loop, timeout ended) + HTTP/status/timeout tests (PLAN 4, 6, 7); `app.py` move
5. [ ] PR open for Karim to merge

## File map
- `backend/halo/gateway/pairing.py` — code/token store
- `backend/halo/gateway/session.py` — per-socket envelope handling + ACK/dedupe
- `backend/halo/gateway/audio.py` — binary frame routing
- `backend/halo/gateway/gateway.py` — `Gateway`, `router`, Host/Origin checks, status + timeout
- `backend/halo/gateway/__init__.py` — re-exports
- `backend/halo/gateway/tests/` — the PLAN suite
- `backend/halo/app.py` — composition-root mount lines (allowed exception)

## Current step
Building; branch `module/gateway`.

## Open questions
- Issue #27 (module:hub_capture): pinned extension id for the Origin default. Not blocking (env-configured, closed default).
- Audio-gap warn has no `system.status` schema slot; surfaced via logs + health counters until Karim says otherwise.
