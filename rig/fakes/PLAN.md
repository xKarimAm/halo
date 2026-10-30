# rig/fakes: PLAN

## Job
Wave 1 (W3, Oct 31, lands by Oct 31 night). Lean test rig: the drop-in fake engines (purple test tooling, never shipped). Same wire protocols as the real engines, switched per engine by env (e.g. `HALO_FAKES=1` / `HALO_ENGINES=fake`): the backend under test cannot tell them from Voice / Spark except by the flag.

## Inputs (contracts consumed)
Fixture scripts from `rig/replayer`'s format: `asr_script.jsonl` (turns at audio offsets) and `llm_script.jsonl` (canned JSON per fixture turn). Audio frames / chat requests on the real wire shapes.

## Outputs (contracts emitted)
FakeASR: speaks the Muse Voice Transcribe realtime WS protocol to the Transcriber; emits the fixture's scripted turns at offsets matching the audio it receives. FakeLLM: OpenAI-compatible `/v1/chat/completions` standing in for both Spark Open and the contributor model; canned JSON per fixture turn. No envelopes of its own.

## Lane (the files it owns)
`rig/fakes/**` (FakeASR server, FakeLLM server, knobs, tests). Python parts ride the root uv project.

## Depends on
`contracts` (message shapes), fixture format (`rig/replayer`). Blocks every L1/L2 test that touches ASR or an LLM.

## Fakes it tests with
It is the fake layer. Self-tests run it against the golden samples in `contracts`.

## Done = tests
Run: `uv run pytest rig/fakes -q`. Concrete cases (diagram boxes): FakeASR — (1) fed the fixture's PCM, emits the scripted turns at the scripted offsets (within the ±200 ms Transcriber tolerance); (2) latency knob delays turns by the set amount; (3) forced session drop closes the WS mid-stream on command; (4) AR/EN code-switch script emits mixed-language turns. FakeLLM — (5) returns the canned JSON for the matched fixture turn and validates against the caller's schema; (6) latency-spread knob pushes chosen calls past 4 s (drives `llm` failover); (7) invalid-JSON-rate knob returns malformed bodies at the set rate (drives retry-then-failover). (8) Both: with the fake flag off, the backend's real client config is byte-identical (no test-only branches in backend code).

## Cut line
Never cut — every offline gate depends on it. The knobs beyond latency / bad-JSON / session-drop are post-MVP (no chaos kit; DECISIONS cut it with the socket-only ACK decision).

## Doubts
Answered: fakes are W3 Wave 1, same-wire drop-ins (batches 2–3). Answered (review): turn matching for FakeLLM is by prompt substring (the fixture turn's first words), falling back to the next unplayed canned reply in order.
