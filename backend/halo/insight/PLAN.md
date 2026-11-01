# insight: PLAN

## Job
Wave 2 (W1, Oct 31 afternoon – Nov 1). Critical path. On each `turn.attributed`: at most 1 call / 3 s / speaker, at most 30 RPM (Karim 2026-11-01; the old 12 only fit Baseten's basic tier, which Halo no longer uses). When a cap blocks a call, that speaker's turns are **held and coalesced**: they go together in the next allowed call (all of them as “new words”, no extra call queued), and the resulting point carries every held `turn_id`. Nothing is burst and nothing is dropped. Calls for different speakers run in parallel, one in flight per speaker; turns that arrive while a speaker's call is in flight are held for that speaker's next call (2026-11-01: one call at a time made a turn wait for another speaker's call, doubling live latency). Spark Open via `llm` (`reasoning_effort` low); per-call failover is handled in `llm`, every point records its `engine`. Points in the viewer's language + original quote + first-guess `urgency` + `is_action` in the same call (no extra latency). On `speaker.mapped.corrects[]` it does **not** re-run the model (RPM cap): it looks up points already made from those `turn_id`s (per-meeting `turn_id → point_ids` map) and re-sends each as `points.upsert` with the same `point_id`, new `tile_id` + `speaker_name`, `attribution: locked`, text unchanged. `replaces` is only for a new point (new `point_id`) whose content supersedes an old one. Latest `meeting.context` applies to later turns only; emitted points are never reprocessed.

## Inputs (contracts consumed)
Bus: `turn.attributed`, `speaker.mapped`, `meeting.context` (latest wins: subject, agenda, roles, `viewer_lang`; missing context ⇒ `viewer_lang` defaults to `en`, no subject/agenda).

## Outputs (contracts emitted)
`points.upsert {point_id, tile_id, speaker_name, kind: point|question|decision|pushback, text, lang, quote, turn_ids[], rank: 1–3, attribution, urgency?, is_action, engine, replaces?}` — upsert by `point_id`; the Overlay moves the same bubble on a correction re-send and removes the old point on `replaces`. `llm.health {engine, p90_ms}` on engine change and at most once every 30 s otherwise. Health callable for `system.status` (`llm {engine, failover}`).

## Lane (the files it owns)
`backend/halo/insight/**` (+ `tests/`, prompt templates; prompt order: fixed instructions, meeting context, speaker's current points, new words last; one stable `prompt_cache_key` per template).

## Depends on
`contracts`, `bus`, `llm`. Day-0 `spark-latency` probe: failover covers a slow/failing Spark Open, no plan change.

## Fakes it tests with
FakeLLM (`rig/fakes`): canned JSON per fixture turn; knobs for latency spread (>4 s failover) and invalid-JSON rate (retry). No keys in tests.

## Done = tests
Run: `uv run pytest backend/halo/insight -q`. Concrete cases: (1) a `turn.attributed` produces a schema-valid `points.upsert` in the `viewer_lang` with the original `quote`, `rank` 1–3, `engine` recorded, latency p90 under 4 s against FakeLLM's nominal profile (L2/L4 measure the real budget). (2) A second turn from the same speaker within 3 s makes no call, and the next allowed call includes both `turn_id`s (its point carries every held `turn_id`); at 30 RPM the excess is coalesced the same way — never burst, never dropped (FakeLLM call count + held-turn payloads assert this). (3) `corrects[]` re-sends the same `point_id` with the new tile/name and `locked`, with zero new model calls (FakeLLM call count unchanged). (4) Content-superseding output sets `replaces` to the old `point_id`. (5) Late `meeting.context` (Arabic) changes the next point's language and leaves earlier points untouched. (6) `llm.health` fires on a failover engine change and not more than once per 30 s otherwise. Diagram test from the box — FakeLLM latency + bad-JSON knobs — is cases (2)+(3) of the `llm` PLAN exercised end-to-end here.

## Cut line
Never cut (critical path; Spark Open on Baseten is the open-weights prize entry and stays the default). Depth cuts land in Notes Builder (✂4), not here.

## Doubts
Answered: correction re-send, no re-run (batch 4). Answered (review): caps never drop turns — blocked speakers' turns are held and sent together in the next allowed call, the resulting point carrying every `turn_id` (no queue of calls, no lost content).
