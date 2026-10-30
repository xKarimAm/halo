# contracts: STATE

## Goal
Implement contracts per its PLAN.md; done ONLY when `uv run pytest contracts -q` passes and the contract tests for contracts pass.

## Key decisions
- Each `<type>.schema.json` validates the envelope `data` object; `envelope.schema.json` validates the CloudEvents wrapper. `contracts/validate.py` is the public validation seam (wrapper + per-type data + meetingid-null rule + `known_type`).
- Binary framing lives in `contracts/binary.py` (little-endian pack/parse helpers) and is documented in `catalog.md`.
- Codegen (`contracts/codegen.py`) generates one committed pydantic module and one committed TS types file from the schemas; `--check` compares without writing.
- Wave 0 root scaffolding (pyproject, CI, PR template, .env.example, extension/package.json) was created here; packaging owns those files from now on. `backend/halo/app.py` is the one allowed lane exception.
- Page JSON issue #14 (approved 2026-10-31; decided from the issue approval while unattended): `meeting.degraded` required bool (mirrors `notes.ready.degraded`); top-level `actions[]` required (notes.ready action shape + required `point_id` uuid); `people[].relevant_points` / `own_points` required uuid arrays into `points[]`. Assumption: `point_id` is required on every action (every action traces to a live point; the live fallback builds actions from `is_action` points) and `actions` is required top-level (empty when none). Golden `page.json` + codegen regenerated; notes-page drops its PROVISIONAL fallbacks on merge.

## Task graph
1. [x] Schemas + catalog + validate/binary helpers -> commit 83b9147
2. [x] Golden samples + golden page JSON -> commit 8774ee1
3. [x] Codegen + generated output -> commit d338976
4. [x] ext/port.ts + ext/meeting-adapter.ts -> commit d18e9e9
5. [x] ACK test kit -> commit 5297567
6. [x] Root scaffolding (pyproject, package.json, CI, import-linter) -> commits 8774ee1, 79510ca
7. [x] backend/halo/app.py skeleton (+ minimal Bus) -> commit 5b937fd
8. [x] Full verification + PR

## File map
- `contracts/*.schema.json` — one schema per JSON type
- `contracts/catalog.md` — type -> emitter -> consumers, binary layouts, HTTP shapes
- `contracts/golden/*.json` — one golden envelope per type (+ page JSON)
- `contracts/validate.py`, `contracts/binary.py` — validation/framing seams
- `contracts/codegen.py`, `contracts/gen/pydantic/models.py`, `contracts/ext/gen/types.ts` — codegen
- `contracts/ext/port.ts`, `contracts/ext/meeting-adapter.ts` — TS-only contracts
- `contracts/ack-kit/` — ACK fixtures + README (runners: gateway, hub_capture, event_store)
- `contracts/tests/` — L0 tests
- `backend/halo/app.py`, `backend/halo/bus/` — Wave 0 composition-root skeleton (Bus + FastAPI; `uv run halo` boots)

## Current step
Wave 0 merged. Issue #14 page-JSON change implemented on this branch (schema + golden + codegen + tests green); PR open for Karim to merge. Next lanes build against these contracts.

## Open questions
None. (Assumption above — `point_id` required on every action — is recorded for the reviewer rather than left open; the approval text says "plus point_id" with no optionality noted.)
