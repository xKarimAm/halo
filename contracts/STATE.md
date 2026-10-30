# contracts: STATE

## Goal
Implement contracts per its PLAN.md; done ONLY when `uv run pytest contracts -q` passes and the contract tests for contracts pass.

## Key decisions
- Each `<type>.schema.json` validates the envelope `data` object; `envelope.schema.json` validates the CloudEvents wrapper. `contracts/validate.py` is the public validation seam (wrapper + per-type data + meetingid-null rule).
- Binary framing lives in `contracts/binary.py` (little-endian pack/parse helpers) and is documented in `catalog.md`.
- Codegen (`contracts/codegen.py`) generates one committed pydantic module and one committed TS types file from the schemas; `--check` compares without writing.

## Task graph
1. Schemas + catalog + validate/binary helpers -> commit
2. Golden samples + golden page JSON -> commit
3. Codegen + generated output -> commit
4. ext/port.ts + ext/meeting-adapter.ts -> commit
5. ACK test kit -> commit
6. Root scaffolding (pyproject, package.json, CI, import-linter) -> commit
7. backend/halo/app.py skeleton -> commit
8. Full verification + PR

## File map
- `contracts/*.schema.json` — one schema per JSON type
- `contracts/catalog.md` — type -> emitter -> consumers, binary layouts, HTTP shapes
- `contracts/golden/*.json` — one golden envelope per type (+ page JSON)
- `contracts/validate.py`, `contracts/binary.py` — validation/framing seams
- `contracts/codegen.py`, `contracts/gen/pydantic/models.py`, `contracts/ext/gen/types.ts` — codegen
- `contracts/ext/port.ts`, `contracts/ext/meeting-adapter.ts` — TS-only contracts
- `contracts/ack-kit/` — ACK fixtures + README (runners: gateway, hub_capture, event_store)
- `contracts/tests/` — L0 tests

## Current step
Task 1: schemas.

## Open questions
None.
