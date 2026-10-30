"""Composition root (the one import-linter exception): wires the modules,
creates the binary queues and mounts the routers. Created in Wave 0 so
`uv run halo` boots early; each W1 backend PR adds its own wiring lines here.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import uvicorn
from fastapi import FastAPI

from halo.bus import Bus
from halo.gateway import Gateway, host_check, router

HOST, PORT = "127.0.0.1", 8765


def create_app(bus: Bus | None = None) -> FastAPI:
    app = FastAPI(title="Halo backend")
    app.state.bus = bus or Bus()
    # Bounded binary queues (no envelope): Gateway -> Transcriber / Recorder.
    app.state.audio_tab_queue = asyncio.Queue(maxsize=200)
    app.state.audio_mic_queue = asyncio.Queue(maxsize=200)
    app.state.rec_queue = asyncio.Queue(maxsize=200)
    # Gateway owns /ws, /pair and the Host + Origin checks (moved out of here).
    app.state.gateway = Gateway(
        app.state.bus,
        data_dir=Path(os.environ.get("HALO_DATA_DIR") or "data"),
        audio_tab=app.state.audio_tab_queue,
        audio_mic=app.state.audio_mic_queue,
        rec=app.state.rec_queue,
        extension_id=os.environ.get("HALO_EXTENSION_ID", ""),
    )
    app.include_router(router)
    app.middleware("http")(host_check)

    @app.get("/healthz")
    async def healthz() -> dict:
        return {"status": "ok", "bus_health": app.state.bus.health()}

    return app


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
