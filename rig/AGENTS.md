# rig/

The offline test rig: test tooling only, never shipped. Three lanes, each labelled `module:<folder>`:

| Folder | Job | Tests |
|---|---|---|
| `fakes/` | FakeASR + FakeLLM on the real wire protocols, switched on by `HALO_FAKES=1` | `uv run pytest rig/fakes -q` |
| `replayer/` | Replays a fixture through the real backend (L2) and the joined run; checker for golden asserts | `uv run pytest rig/replayer -q` |
| `fake_meet/` | Fake Meet page (Node server) + Playwright harness that loads the real extension (L3) | `npm --prefix rig/fake_meet test` |

Each lane has `STATE.md` (read its **File map** first) and `PLAN.md` (the spec). `replayer/README.md` covers modes, the fixture format, regenerating the fixture and the local-only L4 run.

## Fixtures

- `replayer/fixtures/synthetic/`: the one committed fixture and the CI golden (`expected.jsonl`). Regenerate with `uv run python -m rig.replayer.generator`. The `*.pcm` files are raw audio.
- `rig/fixtures/<name>/`: Karim's recorded calls, local only and git-ignored.
- `.pw-browsers/` at the repo root is the Playwright browser cache the joined run uses (git-ignored, about 500 MB).

The Python lanes run from the repo root; `fake_meet/` is its own npm package.
