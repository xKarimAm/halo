# rig/replayer

Modes, checker, fixture format and OBS converter. Run tests:
`uv run pytest rig/replayer -q`; golden: `uv run pytest rig/replayer/tests/test_replay_golden.py -q`.
Regenerate the committed synthetic fixture: `uv run python -m rig.replayer.generator`.

## L4 (local only, never CI, never committed)

Karim's recorded bilingual calls stay outside the repo. Convert a pair,
freeze one real-engine run's output as that fixture's `expected.jsonl`,
then run the same checker the CI golden uses:

```
uv run python -c "from rig.replayer.obs import convert_obs_pair; convert_obs_pair('desktop.wav','mic.wav','rig/fixtures/local-call')"
uv run pytest rig/replayer/tests/test_replay_golden.py -q  # CI golden stays synthetic
```

The L4 check itself is a local `check(expected, actual)` call against the
frozen run's stored envelopes (ts ±300 ms, fuzzy text, ids ignored).
