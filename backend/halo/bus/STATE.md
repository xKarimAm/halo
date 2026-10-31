# bus: STATE

## Goal
Implement bus per its PLAN.md; done ONLY when `uv run pytest backend/halo/bus -q` passes and the contract tests for bus pass.

## Key decisions
- In-process asyncio EventBus: `publish(envelope)` validates via `contracts.validate` and returns a typed Ack at once; `subscribe(type)`; one Event Store tap via `set_tap`; `health()` aggregates `register_health` callables.
- A failing health callable reports `"down"`, never raises out of `health()`.
- Subscribers run in subscription order on the event loop; sync and async subscribers both supported.
- No retries: a throwing subscriber is logged and isolated; it is called exactly once per publish and never blocks later subscribers.
- Pairing is NOT enforced here: `unpaired` is a Gateway/socket concern (envelope before `pair.ok`). The bus validates shape and type only.

## Task graph
1. [x] Wave 0 skeleton: `bus.py` + 3 tests (valid/invalid/unknown, health, isolation)
2. [x] Extend to the full PLAN suite without rewriting: tap-sees-everything-exactly-once, subscription order + no-retry call counts (this branch)

## File map
- `backend/halo/bus/bus.py` — the Bus implementation
- `backend/halo/bus/__init__.py` — re-exports `Bus`
- `backend/halo/bus/tests/test_bus.py` — the PLAN suite
- `backend/halo/bus/PLAN.md` — the contract for this lane

## Current step
Extended tests committed on `module/bus`; PR open for Karim to merge.

## Open questions
None.
