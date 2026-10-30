# rig/replayer: PLAN

## Job
Wave 1 (W3, Oct 31, lands by Oct 31 night). Lean test rig: the Replayer (both modes), the Golden asserts checker (L2 and L4), the fixture format, the synthetic-fixture generator, and the OBS-recording-to-fixture converter (Fixture Capture). A hub record mode is **not** in the MVP. Purple test tooling — never shipped. CI golden = the committed synthetic fixture; Karim's 2–3 recorded bilingual calls (OBS: screen + separate desktop and mic tracks) stay local for the L4 real run, never committed.

## Inputs (contracts consumed)
A fixture directory: `meta.json` (tiles, roles, `t0_ms`), `tab.pcm`, `mic.pcm`, `rec.webm`, `envelopes.jsonl` (with `ts_ms`), `frames/*.jpg`, `asr_script.jsonl` → FakeASR, `llm_script.jsonl` → FakeLLM, `faces.jsonl` → detector truth, `expected.jsonl` → checker.

## Outputs (contracts emitted)
Mode A (fake extension): pairs with a test token, sends `meeting.started`, envelopes and binary audio + rec chunks at their recorded `ts_ms` (1× real time, or fast on a virtual clock), honours ACK + resend — plays the extension side to the real Gateway. Mode B (fake backend): replays recorded backend → extension events to the real extension on the Fake Meet page. Golden asserts (plain tests): a run (`events.sqlite` + what the Replayer received) must match `expected.jsonl` — ts ±300 ms, fuzzy text, ids ignored, order per tile. Chaos limited to the contract kit (drop-ACK / duplicate), no chaos framework.

## Lane (the files it owns)
`rig/replayer/**` (both modes, checker, fixture format + generator, OBS converter, tests). Python parts ride the root uv project.

## Depends on
`contracts` (envelopes + binary framing + ACK rules), `rig/fakes` (script formats). Blocks L2 and the thin milestone's backend half.

## Fakes it tests with
It is test tooling; its own tests replay the synthetic fixture against a stub Gateway and assert the checker catches a planted mismatch.

## Done = tests
Run: `uv run pytest rig/replayer -q`; golden: `uv run pytest rig/replayer/tests/test_replay_golden.py -q`. Concrete cases (diagram box + Wave 1 Done): (1) Mode A: the synthetic fixture replays through the real Gateway and the asserts pass (Wave 1's Done line). (2) Drop an ACK → the Replayer resends the same `id`; send a duplicate → one stored row. (3) Checker teeth: mutate one expected timestamp by 1 s / swap two same-tile events → the golden test fails; different random ids → still passes. (4) Fast virtual-clock replay finishes the fixture in seconds with identical assert results to 1×. (5) OBS converter: a desktop+mic track pair becomes `tab.pcm`/`mic.pcm` + a starter `asr_script.jsonl` without hand-editing. (6) L4 support: the same checker runs Karim's local fixture against a frozen real-engine run (command documented, never wired into CI).

## Cut line
Never cut the Mode A golden (L2 blocks CI from its first test). Mode B depth beyond the Overlay's needs and converter polish are the trimmable edges if the rig runs late — the Fake Meet page + FakeASR/FakeLLM still land Oct 31 night.

## Doubts
Answered: rig ownership split (batch 2). Answered (review): fuzzy text match = normalised (case/whitespace/punctuation-folded) containment per turn, not edit distance — good enough to catch wrong-turn wiring without flaking on ASR wording in L4.
