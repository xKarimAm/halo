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
Real Voice shapes (branch `module/fakes-realshapes`, worktree `.tmp/wt-fakes-realshapes`):
10/10 fakes tests green, ruff clean, mypy (report-only) clean. Blocked on #53:
this server's new shapes need the new transcriber to produce finals, so this
PR's CI stays red until #53 merges and this branch rebases (verified by a
post-merge simulation probe instead: new server + new assembler = exactly one
turn, text/speaker/offsets right). Next: push, open PR, rebase after #53.

## Open questions
- Script-format field names await replayer confirmation (issue #3, non-blocking: building against the assumed format above).
