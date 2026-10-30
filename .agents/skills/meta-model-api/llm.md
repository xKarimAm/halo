# LLM calls: Muse Spark 1.3 and Muse Spark Open

## Providers

| Engine | Base URL | Model id | Key env var |
|---|---|---|---|
| Spark Open (default for Insight) | `https://inference.baseten.co/v1` | `meta-models/muse-spark-open-1026` (the hackathon key works with this id only) | `BASETEN_API_KEY` |
| Spark 1.3 (failover) | `https://api.meta.ai/v1` | `muse-spark-1.3` | `META_API_KEY` |

Both speak the OpenAI Chat Completions API (verified 2026-10-29: plain replies, tool calls and the Responses API all return 200 on Baseten). One adapter with the base URL, model and key as config covers both.

**Spark Open on Baseten always reasons and defaults to `xhigh`, the slowest depth.** It accepts `low`, `medium`, `high`, `xhigh`; `none` and `minimal` run as `low` (docs.baseten.co/inference/model-apis/reasoning). Every Spark Open call sends `reasoning_effort` explicitly: `"low"` for live Insight. Its reply carries the thinking in `message.reasoning_content` and the answer in `message.content`: read only `content`.

## Structured output (the template is the contract)

- Request JSON with `response_format={"type": "json_schema", "json_schema": {"name": ..., "schema": ...}}`, or `client.beta.chat.completions.parse(response_format=PydanticModel)`.
- **The Meta API enforces the schema; Spark Open on Baseten accepts `json_schema` but does not enforce it** (docs.baseten.co/inference/structured-outputs). Its replies can come back in the wrong shape.
- Lock the schema: `additionalProperties: false`, every field `required`, `enum` for closed sets.
- Recursive `$ref` schemas return HTTP 400. Flatten them.
- Validate every response against the schema in `/contracts` on every engine. On a validation failure, retry once on the same engine; if it fails again, send that call to Spark 1.3 (schema-enforced) and emit a failover event.

## Latency levers (live Insight targets ~3 s, p90 under 4 s)

- Set reasoning effort on every live call: `"low"` on Spark Open (its floor), `"minimal"` on Spark 1.3 (Meta ladder: `none` < `minimal` < `low` < `medium` < `high`; `"none"` is unreliable today). Reasoning tokens bill as output and arrive before the first streamed token, so effort is latency.
- Prompt caching is automatic and matches from the first token. Order every prompt as: fixed instructions, then meeting context, then the speaker's current points, then the new words last. Pass one stable `prompt_cache_key` per prompt template, never one per user. Watch `usage.prompt_tokens_details.cached_tokens`.
- Stream with `stream=True` and `stream_options={"include_usage": True}`. `delta.content` can be `None` and the usage chunk has empty `choices`; guard both.

## Errors

- Retry only 429, 5xx and timeouts, with exponential backoff, jitter and a cap. Fix 400, 401 and 404 instead of retrying them.
- Branch on `status_code` and the body's `type`; `code` is often null.
- Throttle from the `x-ratelimit-remaining-*` headers. A dropped stream raises `APITimeoutError` or `APIConnectionError`: keep the partial text and treat it as a transport failure.

## Unsupported on the Meta API (HTTP 400)

`stop`, `n > 1`, `logit_bias`, `verbosity`, and any `tool_choice` other than `"auto"`. Images go only in `user` messages.
