# contracts/

The only thing modules share. One lane, labelled `module:contracts`. Every change here also gets the `contract-change` label and waits for Karim; other lanes ask for changes through an issue (root `AGENTS.md`, "Module lanes").

## Files

- `catalog.md`: start here. Each event type, its schema file, emitter and consumers, plus the envelope and ACK rules.
- `<type>.schema.json`: one JSON Schema per event type; `envelope.schema.json`, `ack.schema.json`, `meeting-page.schema.json` (the Notes page JSON).
- `golden/<type>.json`: one valid sample per type; fakes and tests build on these.
- `ack-kit/`: ACK edge cases (duplicate, invalid schema, unpaired, unknown type, dropped ACK).
- `ext/`: TypeScript for the extension: `port.ts` (Port protocol), `meeting-adapter.ts` (`MeetingAdapter` interface).
- `validate.py` (`validate_envelope`, `validate_ack`), `binary.py` (binary frame header).
- Generated from the schemas by `codegen.py`: `gen/pydantic/models.py` and `ext/gen/types.ts`. Edit the schema, then run `uv run python -m contracts.codegen`.

## Tests

- `uv run pytest contracts -q`
- Drift check (CI blocks on it): `uv run python -m contracts.codegen --check`
