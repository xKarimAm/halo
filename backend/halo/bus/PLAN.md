# bus: PLAN

## Job
Wave 2 (W1, Oct 31 afternoon – Nov 1). The in-process asyncio EventBus: the only way backend modules talk. No diagram box; DECISIONS §3 defines it. Every backend envelope travels as a Bus topic by `type`; no module imports another module's code (import-linter allows only `backend/halo/app.py` to import every module).

## Inputs (contracts consumed)
Any validated envelope from `/contracts`. Subscriptions by `type` via `subscribe(type)`.

## Outputs (contracts emitted)
`publish(envelope)` validates against `/contracts` and returns a typed Ack at once (same ACK schema as the socket: `invalid_schema | unknown_type | unpaired | internal`; no retries). `health()` aggregates callables registered with `register_health(name, fn)`. An Event Store tap receives every accepted envelope. ACK lives on the socket only between extension and Gateway; inside the backend this return value is the whole mechanism.

## Lane (the files it owns)
`backend/halo/bus/**` (bus implementation + `tests/` inside the lane).

## Depends on
`contracts` (schemas + generated pydantic types).

## Fakes it tests with
In-memory subscribers/publishers in its own tests; no module fakes (it has no module dependencies).

## Done = tests
Run: `uv run pytest backend/halo/bus -q`. Concrete cases: (1) publish valid envelope → Ack `ok`, subscriber for that `type` receives it, other types do not. (2) Schema-invalid envelope → Ack `error/invalid_schema`, nothing delivered, nothing tapped. (3) Unknown `type` → `error/unknown_type`. (4) Event Store tap sees every accepted envelope exactly once. (5) `register_health` + `health()` returns each registered name's callable result; a failing callable reports down, not an exception out of `health()`. (6) No retry: a throwing subscriber does not cause re-delivery.

## Cut line
Never cut (critical path plumbing). No rings; search depth and other ring-2 concerns belong to consumers, not the bus.

## Doubts
Answered: health registration and Gateway polling (`bus.health()` every 5 s) pinned in planning batch 2. Answered (review): publish delivers to subscribers in subscription order on the event loop; a throwing subscriber is logged and isolated so one bad consumer cannot break the Gateway ACK path.
