"""Composition root (the one import-linter exception): wires the modules,
creates the binary queues and mounts the routers. Created in Wave 0 so
`uv run halo` boots early; each W1 backend PR adds its own wiring lines here.
"""

from __future__ import annotations

import asyncio
import os
import secrets

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse

from halo.bus import Bus

HOST, PORT = "127.0.0.1", 8765
_ALLOWED_HOSTS = {"127.0.0.1", "localhost", "[::1]"}


def _host_ok(host: str | None) -> bool:
    if not host:
        return False
    name = host.rsplit(":", 1)[0] if not host.startswith("[") else host.split("]")[0] + "]"
    return name in _ALLOWED_HOSTS


def create_app(bus: Bus | None = None) -> FastAPI:
    app = FastAPI(title="Halo backend")
    app.state.bus = bus or Bus()
    # Bounded binary queues (no envelope): Gateway -> Transcriber / Recorder.
    app.state.audio_tab_queue = asyncio.Queue(maxsize=200)
    app.state.audio_mic_queue = asyncio.Queue(maxsize=200)
    app.state.rec_queue = asyncio.Queue(maxsize=200)
    app.state.pairing_code = f"{secrets.randbelow(1_000_000):06d}"

    @app.middleware("http")
    async def host_check(request: Request, call_next):  # type: ignore[no-untyped-def]
        if not _host_ok(request.headers.get("host")):
            return JSONResponse({"detail": "foreign host rejected"}, status_code=400)
        return await call_next(request)

    @app.get("/pair", response_class=HTMLResponse)
    async def pair_page() -> str:
        return (
            "<!doctype html><title>Halo pairing</title>"
            "<h1>Halo pairing</h1><p>Enter the 6-digit code printed by "
            "<code>uv run halo</code> in the Halo extension popup.</p>"
        )

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
    print(f"Halo backend on http://{HOST}:{PORT} - pairing code: {app.state.pairing_code}", flush=True)
    uvicorn.run(app, host=HOST, port=PORT)


if __name__ == "__main__":
    main()
