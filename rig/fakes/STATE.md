# rig/fakes: STATE

## Goal
Implement rig/fakes per its PLAN.md; done ONLY when `uv run pytest rig/fakes -q` passes and the contract tests for fakes pass.

## Key decisions
- Stdlib + already-locked deps only (fastapi for the servers, jsonschema for caller-schema validation): no new dependencies, no pyproject change (lane is `rig/fakes/**` only).
- Script format assumed pending replayer confirmation (issue #3): `asr_script.jsonl` lines `{stream, speaker, text, lang, ts_start_ms, ts_end_ms}` (offsets from meeting t0); `llm_script.jsonl` lines `{match, response}` (match = prompt substring, fallback = next unplayed reply in order, per PLAN Doubts).
- Core engines are transport-agnostic and deterministic (injected sleeper/clock); the FastAPI server is a thin wire adapter so unit tests never wait on real latency knobs.

## Task graph
1. Script loaders (asr/llm jsonl) -> engines.
2. FakeASR engine (offsets, latency knob, forced drop, code-switch passthrough).
3. FakeLLM engine (substring match + fallback, schema validation, latency-spread + invalid-JSON knobs).
4. Env config seam (flag off = real config byte-identical).
5. FastAPI wire servers (OpenAI-compatible LLM, Voice-shaped ASR WebSocket).
6. Tests for PLAN Done cases (1)-(8).

## File map
- `rig/fakes/scripts.py`: jsonl loaders + turn/reply types.
- `rig/fakes/fake_asr.py`: FakeASR engine.
- `rig/fakes/fake_llm.py`: FakeLLM engine.
- `rig/fakes/config.py`: HALO_FAKES env seam.
- `rig/fakes/server.py`: FastAPI apps for both fakes.
- `rig/fakes/tests/test_fakes.py`: PLAN Done cases (1)-(8).

## Current step
Gate 7 (branch `module/fakes-gate7`, worktree `.tmp/wt-fakes-gate7`, stacked on
the llm gate-7 branch): 13/13 tests green. New: `HALO_FAKE_PORT` endpoint
override; LLM app model-keyed `errors_by_model`/`sleep_by_model` knobs; the
ASR script/open-turns/turn-counter live as long as the app so a dropped
session resumes on reconnect (control.drop closes only the connection now;
engine poisoning stays available via `FakeASR.drop_session`). Next: push, PR.

## Open questions
- Script-format field names await replayer confirmation (issue #3, non-blocking: building against the assumed format above).
