# packaging: STATE

## Goal
Implement packaging per its PLAN.md; done ONLY when the release checks pass: the boot check boots a paired-capable backend from the shipped entry point, `pytest`/`ruff`/`lint-imports` are green, and the extension build step exists in CI.

## Key decisions
- Seams: the shipped entry points (`halo` console script == `python -m halo.app`), the root files (README, `.env.example`, `pyproject.toml`, CI), and `packaging/release_check.py` run as a script (not a pytest test — it boots a real server).
- `release_check.py` resolves the repo root from its own location and prepends `<root>` + `<root>/backend` to `PYTHONPATH`, so it always boots the tree under test. Bounded: 60 s for the pairing-code line, then `/pair` 200, foreign-Host 400, then terminate.
- Drift test `packaging/tests/test_env_example.py` asserts `.env.example` names exactly the env vars the backend reads (`HALO_DATA_DIR`, `HALO_EXTENSION_ID`, `META_API_KEY`, `BASETEN_API_KEY`, `HALO_FAKES`); needs `packaging` added to pytest `testpaths`.
- CI gains the PLAN-mandated extension `build` step. npm is unusable in this sandbox, so the build itself is verified by CI, not locally — stated in the PR.
- Mypy stays report-only in CI (other windows' lanes land tonight; flipping the gate is Karim's call) — stated in the PR.
- README: install steps verified against the tree (`halo` script, `/pair` page, WXT default output dir); status line updated to landing state.

## Task graph
1. [x] `packaging/STATE.md`
2. [x] `packaging/release_check.py` + ran as evidence (PASS twice)
3. [x] `packaging/tests/test_env_example.py` + `testpaths`
4. [x] `.env.example` (+`HALO_EXTENSION_ID`, `HALO_ENGINES`, `HALO_FIXTURE_DIR`), README refresh
5. [x] CI extension build step ATTEMPTED, reverted: `wxt build` fails on setup_panel's top-level await (filed as #46 to module:setup_panel); build step returns when #46 lands
6. [x] Full gates + PR #45 open for Karim to merge

## Evidence notes
- `release_check.py`: PASS (boot + pairing code + `/pair` 200 + foreign-Host 400). One transient FAIL observed when another process held the fixed :8765 (fails closed — intended for a release check).
- npm is unusable in this sandbox, so `npm run build` is verified by CI, not locally.
- Mypy stays report-only in CI (other windows land tonight); all 46 files pass locally.

## File map
- `packaging/PLAN.md` — the lane plan (pre-existing)
- `packaging/STATE.md` — this file
- `packaging/release_check.py` — bounded boot release check
- `packaging/tests/test_env_example.py` — .env drift test
- `pyproject.toml`, `.env.example`, `README.md`, `.github/workflows/ci.yml` — root files (this lane owns)

## Current step
STATE written; release check script next.

## Open questions
None.
