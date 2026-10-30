# llm: STATE

## Goal
Implement llm per its PLAN.md; done ONLY when `uv run pytest backend/halo/llm -q` passes and the contract tests for llm pass.

## Key decisions
- Synchronous `LLMClient` (httpx, OpenAI chat completions); async callers run it in a thread. Same code path for real and fake transports: tests inject `httpx.MockTransport`, production passes none.
- Non-streaming completions. Streaming is a latency lever in the skill, not a PLAN requirement; non-streaming keeps the 4 s budget exact and testable.
- Retry/failover: fast failures (429/5xx/connection errors) sleep backoff+jitter once then retry once same-engine; invalid JSON retries once immediately; timeouts fail over at once with no same-engine retry (a slow engine stays slow). Second failure fails the call over to `muse-spark-1.3-contributor`. 400/401/404 are typed failures, never retried, never failed over.
- The 4 s budget is enforced per attempt (httpx timeout + elapsed check from request send to validated JSON). A valid-but-slow primary reply is discarded in favour of failover.
- Failover demotes Spark Open for 30 s (fake clock in tests); afterwards the next call tries it again.
- `health()` returns the last-used engine plus the in-cooldown flag: `{"engine", "failover"}`. Registered on the bus by `app.py`, not here (lane rule: only `app.py` imports every module).
- `missing_key` fails over to the next engine (it may hold its key); only 400/401/404 stop the whole call.
- `HALO_FAKES=1` (or `HALO_ENGINES` containing `fake`, mirroring `rig/fakes/config.py` without importing it) swaps both engines' base URLs to the FakeLLM server, which stands in for both. Real defaults: Baseten `meta-models/muse-spark-open-1026` with `reasoning_effort: low`; Meta API `muse-spark-1.3-contributor` with `reasoning_effort: minimal`.
- `prompt_cache_key` is forwarded verbatim when provided. Only `message.content` is ever read; `reasoning_content` is ignored.
- `app.py::main()` loads the repo-root `.env` first (minimal parser, never overrides real env, never prints values); this PR is the first that needs keys.

## Task graph
1. [x] `llm.py`: client with retry + per-call failover + health
2. [x] `tests/test_llm.py`: all 7 PLAN cases (12 tests) against a scripted transport
3. [x] `tests/test_dotenv.py`: `.env` loading (repo root file, no override, no value output)
4. [x] `app.py` wiring: `load_dotenv` in `main()`, `LLMClient` on `app.state`, `bus.register_health("llm", ...)`
5. [x] `pyproject.toml`: append `httpx` to project dependencies (llm's own dep)

## File map
- `backend/halo/llm/llm.py` — `LLMClient`, `LLMResult`, engine constants
- `backend/halo/llm/__init__.py` — re-exports
- `backend/halo/llm/tests/test_llm.py`, `tests/test_dotenv.py` — the PLAN suite
- `backend/halo/llm/PLAN.md` — the contract for this lane
- `backend/halo/app.py` — composition-root wiring (allowed lane exception)
- `pyproject.toml` — own-dependency append (allowed)

## Current step
Implemented and green locally; PR open for Karim to merge.

## Open questions
None.
