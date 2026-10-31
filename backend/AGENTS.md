# backend/

One FastAPI modular-monolith process (Python 3.12 + uv). Run every command from the repo root: `uv run halo` boots it on `127.0.0.1:8765` and prints the pairing code. Port 8765 is often Karim's live backend, so manual runs and probes use another port.

## Lanes

Each folder under `backend/halo/` is one lane, labelled `module:<folder>`:

| Folder | Job |
|---|---|
| `bus/` | In-process asyncio EventBus: `publish` validates against `/contracts`, returns an Ack; `subscribe`; health registry |
| `llm/` | The one shared model client (Baseten + Meta API, schema check, retry, failover) |
| `gateway/` | `/ws`, `/pair`, Host + Origin checks, socket ACK + dedupe, binary audio routing, `system.status` |
| `transcriber/` | Muse Voice realtime ASR sessions to final transcripts |
| `correlator/` | Transcripts + speaking tile to `turn.attributed` |
| `insight/` | `turn.attributed` to live points |
| `classifier/` | Batched urgency/category re-tag every 10 s |
| `event_store/` | SQLite + FTS5 tap; views `points_current`, `tags_effective` |
| `notes_builder/` | `meeting.ended` to `notes.ready` |
| `notes_service/` | `/notes/*` + `/api/*`, serves `notes-page/` |
| `recorder/` | Recording chunks to local files |

Who emits and consumes each event: `contracts/catalog.md`. `halo/app.py` is the composition root (packaging lane) and the only file that imports modules; `uv run lint-imports` enforces that, so modules talk over the bus only.

## Working in a module

1. Read the module's `STATE.md`: its **File map** names every file and what it holds. Open only those files.
2. `PLAN.md` in the same folder is the spec (inputs, outputs, acceptance tests).
3. Tests live in `<module>/tests/`. Fakes for every model: `rig/fakes` (`HALO_FAKES=1`).

## Tests

- One module: `uv run pytest backend/halo/<module> -q`
- CI gate: `uv run pytest -q`, `uv run ruff check .`, `uv run lint-imports` (mypy reports only)

Local runtime data lands in `data/` (git-ignored, `HALO_DATA_DIR`).
