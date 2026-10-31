# classifier: STATE

## Goal
Implement classifier per its PLAN.md; done ONLY when `uv run pytest backend/halo/classifier -q` passes and the contract tests for classifier pass.

## Key decisions
- `Classifier` subscribes `points.upsert` + `tags.set`; emits only `tags.set` (`source: model`). The model client is injected duck-typed (`complete_json`, `health`), like Insight; never imports `halo.llm`.
- Tags mirror, not SQLite: user/model tags are tracked from the bus into `user_tags`/`model_tags` maps; effective = model overridden by user (the `tags_effective` layering). This is exact for the queue-driven flow — only arriving points are ever queued, and every tag write in this process also crosses this bus — so no restart gap matters (a pre-restart model answer can only re-run if its point is re-upserted, and then with identical values). No SQLite import in this lane.
- Flush rule per queued id: effective = mirror; missing = kind/urgency absent from effective; no missing → drop (user/model complete, including "same model answer arrives again"). Else exactly one model call with the latest queued text, publishing only the missing fields (user-tagged fields never overridden). Each id drains once per flush (per-tick lock). A failed call keeps the id queued for the next tick and counts toward health. The queue retains each point's meetingid because `tags.set` requires a non-null meetingid.
- Points only: classification needs text, and only `points.upsert` carries it. Action ids are tracked in the mirror (user tags on actions suppress like points) but never trigger model calls — recorded assumption.
- Prompt: current tags first (never contradict), decision text, the two axes (kind, urgency); `prompt_cache_key` constant `classifier-v1`; model schema `{kind, urgency}` required, closed, no refs. The sync call runs in `asyncio.to_thread`.
- Health `tagger`: `ok` unless the last 3 model calls failed consecutively (`down`); a success resets. Registered as `tagger` by `app.py`; engine/failover for status stays the llm client's own entry.
- 10 s loop via `start()`/`stop()` for the `app.py` lifespan; tests drive `flush()` directly.

## Task graph
1. [x] `classifier.py`: queue, mirror, flush rule, prompt, health
2. [x] `tests/test_classifier.py`: all 7 PLAN cases against a scripted model fake
3. [x] `app.py` wiring: construct + lifespan + `tagger` health
4. [x] Full suite green (119 incl. lane 6) + ruff/mypy/lint-imports; PR open for Karim to merge

## File map
- `backend/halo/classifier/classifier.py` — the `Classifier` class
- `backend/halo/classifier/__init__.py` — re-exports
- `backend/halo/classifier/tests/test_classifier.py` — the PLAN suite
- `backend/halo/app.py` — composition-root wiring (allowed exception)

## Current step
Building; branch `module/classifier`.

## Open questions
None (points-only assumption above is recorded for the reviewer).
