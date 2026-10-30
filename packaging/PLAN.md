# packaging: PLAN

## Job
Wave 4–5 (W1, Nov 2; ship Nov 2 night → submit Nov 3). The install story and release checks — **not** the composition root's birthday. `backend/halo/app.py` is created in **Wave 0 (Oct 31, by `contracts`)** with the Bus + the one FastAPI app (`127.0.0.1:8765`) so `uv run halo` boots early: L2 replay and the thin run both start the real backend. Each W1 backend module PR afterwards adds its own wiring lines to `app.py` (bounded queues, health registration, router mounts) — the allowed lane exception (same window, sequential PRs); import-linter exempts that file only. This module's Nov 2 work: README, install steps, release checks. Owns the root files from Wave 0 on (`pyproject.toml`, `extension/package.json`, `.github/`, `.gitignore`, `.env.example`, README): any other lane may append its own dependencies to `pyproject.toml` / a `package.json`; any other root-file change is an issue to `module:packaging`. `wxt.config.ts` + the manifest are **not** here — they belong to `hub_capture` (extension composition root). README carries the install steps (target text already in the root README: clone, `cp .env.example .env`, `uv run halo`, build the extension, load unpacked, pair once).

## Inputs (contracts consumed)
Every module's public factory/health registration (imports allowed here only — import-linter's single exception). `.env` keys (names only in `.env.example`).

## Outputs (contracts emitted)
A shippable install: README + `.env.example` that take a clean clone to a paired, running backend (`/ws` + `/pair` from the Gateway, `/notes/*` + `/api/*` from Notes Service, pairing code on stdout) and a loadable extension build (`extension/.output/chrome-mv3`, built via `hub_capture`'s WXT config). Release-check evidence for Nov 2 night / Nov 3.

## Lane (the files it owns)
`packaging/**` (this plan, release checks), repo root files listed above, `README.md`, `pyproject.toml` (`[project.scripts] halo = …`), CI workflow after Wave 0. `backend/halo/app.py` is a shared wiring file created in Wave 0 and edited sequentially by W1 module PRs — not a Packaging-only lane. Never `wxt.config.ts` or the manifest (`hub_capture`).

## Depends on
Everything (last). Wave 0 scaffolding (created by `contracts`, handed over). Thin milestone (Nov 1 night) exercises this entry point with `HALO_FAKES=1` before ring 2 lands.

## Fakes it tests with
The full rig: smoke-runs `uv run halo` against the synthetic fixture with FakeASR/FakeLLM.

## Done = tests
Run from the repo root: `uv run halo` (boots, prints a pairing code, serves `GET /pair` 200 on 127.0.0.1 and rejects a foreign Host), `uv run pytest` (whole suite), `uv run ruff check .`, `uv run lint-imports` (only `app.py` exempt from lane rules), `npm --prefix extension run build` (produces the loadable MV3 folder). Concrete cases: (1) clean-clone README walkthrough reaches a paired hub against the Fake Meet page. (2) `HALO_FAKES=1 uv run halo` + `npm --prefix rig/fake_meet run test:joined` reproduces the thin milestone from the shipped entry point, not a test-only main. (3) Missing `.env` keys → backend still boots for L0–L3 (fakes), and a live start names the missing key instead of stack-tracing. (4) Nov 2 night: live Meet rehearsal (L5) from this build; cut list applied to anything not solid. (5) Nov 3: demo video recorded from this build; submission = public repo + video (no X post).

## Cut line
Never cut the one-command start or the README install steps (Wave 5 Done = submitted). Trim polish (icons, store listing) before touching the entry point.

## Doubts
Answered: composition-root ownership + root-file rule (batches 2–3). Answered (review): the `halo` console script targets `halo.app:main` inside the backend package (`backend/halo/app.py`), so `uv run halo` and `uv run python -m halo.app` are the same boot.
