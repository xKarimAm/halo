# llm: PLAN

## Job
Wave 2 (W1, Oct 31 afternoon – Nov 1). The one shared model client used by Insight, Classifier, Notes Builder. No diagram box; DECISIONS §3 + `.agents/skills/meta-model-api/llm.md` define it. OpenAI-compatible calls to Baseten (Spark Open) and the Meta API (contributor), schema validation on every result, retry once, per-call failover, `engine` on every result. Emits nothing on the bus; registers a health callable.

## Inputs (contracts consumed)
Call requests from Insight/Classifier/Notes Builder (prompt + JSON Schema name from `/contracts`). Keys only from backend `.env` (`BASETEN_API_KEY`, `META_API_KEY`); never in CI.

## Outputs (contracts emitted)
Validated model JSON + `engine` (`spark-open` | `muse-spark-1.3-contributor`) per call, or a typed failure after retry + failover. Rules: Spark Open always sends `reasoning_effort: "low"`, read only `message.content` (Baseten accepts but does not enforce `json_schema` — always validate locally; on validation failure retry once on the same engine, then fail that call over). Per-call failover to contributor when a call takes over 4 s, its JSON fails twice, or Baseten returns HTTP 429; after 30 s the next call tries Spark Open again. Retry only 429/5xx/timeouts with backoff + jitter; never retry 400/401/404. Schemas locked: `additionalProperties: false`, all fields required, enums closed, no recursive `$ref`. Contributor model for every Spark 1.3 runtime call (DECISIONS §5).

## Lane (the files it owns)
`backend/halo/llm/**` (+ `tests/`).

## Depends on
`contracts` (output schemas). Day-0 `spark-latency` probe (DECISIONS §5): slow/failing Spark Open ⇒ this failover covers it, no plan change.

## Fakes it tests with
`rig/fakes` FakeLLM (canned JSON per fixture turn; knobs: latency spread forcing >4 s failover, invalid-JSON rate forcing retry). No keys, no network in tests.

## Done = tests
Run: `uv run pytest backend/halo/llm -q`. Concrete cases (against FakeLLM): (1) valid Spark Open reply → passes schema, `engine=spark-open`. (2) Bad JSON once → one same-engine retry, then success. (3) Bad JSON twice → failover, `engine=muse-spark-1.3-contributor`. (4) Latency >4 s → failover for that call only; a call 30 s later tries Spark Open again. (5) HTTP 429 → failover; HTTP 400 → typed failure, no retry. (6) `reasoning_effort: "low"` present on every Spark Open request; `content` (not `reasoning_content`) parsed. (7) Health callable reports current engine + failover state.

## Cut line
Never cut (critical path plumbing for Insight). Failover itself is never cut: Spark Open stays the default for the open-weights prize entry.

## Doubts
Answered: emission of `llm.health` belongs to Insight (engine change, else ≤ every 30 s), not this module — planning batch 4. Answered (review): timeout that triggers failover is a per-call 4 s budget measured from request send to validated JSON; streaming partials on timeout count as transport failure, partial text discarded.
