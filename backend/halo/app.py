"""Composition root (the one import-linter exception): wires the modules,
creates the binary queues and mounts the routers. Created in Wave 0 so
`uv run halo` boots early; each W1 backend PR adds its own wiring lines here.
"""

from __future__ import annotations

import asyncio
import os
import re
from collections.abc import MutableMapping
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI

from halo.bus import Bus
from halo.correlator import Correlator
from halo.event_store import EventStore
from halo.gateway import Gateway, host_check, router
from halo.insight import Insight
from halo.llm import LLMClient
from halo.notes_service import NotesService
from halo.notes_service import router as notes_router
from halo.transcriber import Transcriber
from halo.transcriber.transport import WsTransport
from rig.fakes.config import engine_config

HOST, PORT = "127.0.0.1", 8765
_KEY_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")


def load_dotenv(path: Path | str | None = None, *,
                _environ: MutableMapping[str, str] | None = None) -> Path | None:
    """Load `KEY=VALUE` lines from the repo-root `.env` into the environment.

    Never overrides a variable that is already set, and never prints values:
    callers report missing key *names* only. Returns the file loaded, or None
    when there is no file to load.
    """
    env = os.environ if _environ is None else _environ
    target = Path(path) if path is not None else Path(__file__).resolve().parents[2] / ".env"
    try:
        text = target.read_text(encoding="utf-8")
    except OSError:
        return None
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line[:7].lower() == "export ":
            line = line[7:].lstrip()
        name, _, value = line.partition("=")
        name = name.strip()
        if not _KEY_RE.match(name) or name in env:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        env[name] = value
    return target


def _data_dir() -> Path:
    return Path(os.environ.get("HALO_DATA_DIR") or "data")


@asynccontextmanager
async def _lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
    # Background loops need a running event loop, so they start here.
    app.state.gateway.start()
    app.state.insight.start()
    yield
    app.state.insight.stop()
    app.state.gateway.stop()


def create_app(bus: Bus | None = None) -> FastAPI:
    app = FastAPI(title="Halo backend", lifespan=_lifespan)
    app.state.bus = bus or Bus()
    # Bounded binary queues (no envelope): Gateway -> Transcriber / Recorder.
    app.state.audio_tab_queue = asyncio.Queue(maxsize=200)
    app.state.audio_mic_queue = asyncio.Queue(maxsize=200)
    app.state.rec_queue = asyncio.Queue(maxsize=200)
    # Event Store tap: every accepted envelope lands in events.sqlite.
    app.state.store = EventStore(_data_dir() / "events.sqlite")
    app.state.bus.set_tap(app.state.store.tap)
    app.state.bus.register_health("event_store", app.state.store.health_status)
    # Shared model client (llm lane): constructed keyless-safe; per-call
    # failures are typed results, so wiring never needs keys to exist yet.
    app.state.llm = LLMClient()
    app.state.bus.register_health("llm", app.state.llm.health)
    # Gateway owns /ws, /pair and the Host + Origin checks.
    app.state.gateway = Gateway(
        app.state.bus,
        data_dir=_data_dir(),
        audio_tab=app.state.audio_tab_queue,
        audio_mic=app.state.audio_mic_queue,
        rec=app.state.rec_queue,
        extension_id=os.environ.get("HALO_EXTENSION_ID", ""),
    )
    app.include_router(router)
    app.middleware("http")(host_check)
    # Transcriber: two Voice sessions fed from the bounded audio queues.
    # The endpoint swap is the only fake seam (rig.fakes.config).
    asr_url = engine_config()["asr_url"]
    app.state.transcriber = Transcriber(
        app.state.bus,
        app.state.audio_tab_queue,
        app.state.audio_mic_queue,
        lambda stream, mode: WsTransport(asr_url),
        key=os.environ.get("META_API_KEY", ""),
    )
    # Correlator: tile + name on every final turn (internal health only).
    app.state.correlator = Correlator(app.state.bus)
    # Insight: live points from attributed turns via the shared model client.
    app.state.insight = Insight(app.state.bus, app.state.llm)
    app.state.bus.register_health("insight", app.state.insight.health)
    # Notes service: stateless HTTP reads over the store file + notes-page
    # shell; no background loop, so nothing joins the lifespan.
    app.state.notes_service = NotesService(app.state.bus, data_dir=_data_dir())
    app.include_router(notes_router)

    @app.get("/healthz")
    async def healthz() -> dict:
        return {"status": "ok", "bus_health": app.state.bus.health()}

    return app


# Keys must be in the environment before the module-level app builds its clients.
load_dotenv()
app = create_app()


def main() -> None:
    if os.environ.get("HALO_FAKES") != "1":
        missing = [k for k in ("META_API_KEY", "BASETEN_API_KEY") if not os.environ.get(k)]
        if missing:
            print(f"warning: missing keys in .env: {', '.join(missing)} (backend still boots; live engines need them)")
    print(f"Halo backend on http://{HOST}:{PORT} - pairing code: {app.state.gateway.pairing.current_code}",
          flush=True)
    uvicorn.run(app, host=HOST, port=PORT)


if __name__ == "__main__":
    main()
