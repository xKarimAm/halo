# insight: STATE

## Goal
Implement insight per its PLAN.md; done ONLY when `uv run pytest backend/halo/insight -q` passes and the contract tests for insight pass.

## Key decisions
- `Insight` subscribes `turn.attributed` / `speaker.mapped` / `meeting.context`; every other input (the model) arrives as an injected `llm` object shaped like the llm lane's client (`complete_json(...)` -> `{ok, engine, data?, error?}`, plus `health()`). Insight never imports `halo.llm` (lane rule); the llm PR's API is the contract, noted in that PR.
- Caps never drop: per-speaker 1 call / 3 s and global 12 RPM (sliding 60 s) gate a flush; blocked speakers' turns are held and the next allowed call pops ALL of them, carrying every held `turn_id`. A 250 ms loop plus an opportunistic flush on every turn drains held turns during silence and keeps latency low when busy.
- The sync model call runs in `asyncio.to_thread` so one slow call never stalls the bus loop.
- Prompt order per the skill: fixed instructions, meeting context, the speaker's current points, new words last; one stable `prompt_cache_key` (`insight-v1`). Point `lang` = latest `viewer_lang` (default `en`); `tile_id`/`speaker_name`/`attribution` come from the latest held turn.
- `corrects[]` never re-runs the model: stored points are re-sent with the same `point_id`, new tile/name, `attribution: locked`, text unchanged. `replaces` passes through only when the model sets it on a new point.
- A failed model call re-queues the turns at the front (order preserved) under the normal per-speaker window; nothing is lost.
- `llm.health {engine, p90_ms}` publishes on engine change, else at most every 30 s (p90 over the last 100 calls). The `bus.register_health("llm", ...)` callable stays the llm client's own (registered by `app.py`); `Insight.health()` delegates to it so there is exactly one `llm` health source.
- Latest `meeting.context` wins per meeting and applies to later turns only; emitted points are never reprocessed.

## Task graph
1. [x] `insight.py`: caps, coalescing, prompt, corrections, health emission
2. [x] `tests/test_insight.py`: all 6 PLAN cases + failure re-queue, against a scripted llm fake
3. [x] Full suite green (8 tests) + ruff/mypy/lint-imports; PR open for Karim to merge

## File map
- `backend/halo/insight/insight.py` — the `Insight` class + model schema + prompt
- `backend/halo/insight/__init__.py` — re-exports
- `backend/halo/insight/tests/test_insight.py` — the PLAN suite
- `backend/halo/insight/PLAN.md` — the contract for this lane

## Current step
Building; branch `module/insight`.

## Open questions
None.
