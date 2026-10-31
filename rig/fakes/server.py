"""Wire adapters: FakeLLM as an OpenAI-compatible HTTP app, FakeASR as a
Voice-shaped WebSocket. Run: `uv run python -m rig.fakes.server` (needs a
fixture dir via HALO_FIXTURE_DIR with asr_script.jsonl / llm_script.jsonl).

Voice session handshake: the first JSON frame per connection may carry
``stream`` ("tab"|"mic") and ``t0_ms`` (meeting-clock anchor). Other keys
(auth, mode, hints) pass through untouched. Without them the connection
behaves as before (tab stream, wall-clock stamps).
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect

from rig.fakes.fake_asr import FakeASR, SessionDropped
from rig.fakes.fake_llm import FakeLLM
from rig.fakes.scripts import load_asr_script, load_llm_script


def create_llm_app(fake: FakeLLM) -> FastAPI:
    app = FastAPI()

    @app.post("/v1/chat/completions")
    async def completions(request: Request) -> dict:
        body = await request.json()
        prompt = "\n".join(m.get("content", "") for m in body.get("messages", []))
        schema = None
        fmt = body.get("response_format") or {}
        if fmt.get("type") == "json_schema":
            schema = fmt.get("json_schema", {}).get("schema")
        return fake.complete(prompt, schema=schema)

    return app


def create_asr_app(fake: FakeASR) -> FastAPI:
    app = FastAPI()

    @app.websocket("/v1/voice/realtime")
    async def realtime(ws: WebSocket) -> None:
        await ws.accept()
        stream = "tab"
        t0_ms: int | None = None
        position_ms = 0
        configured = False
        try:
            while True:
                msg = await ws.receive()
                if msg.get("bytes") is not None:
                    pcm = msg["bytes"]
                    if t0_ms is None:
                        stamp = int(time.time() * 1000)
                    else:
                        stamp = t0_ms + position_ms
                    position_ms += len(pcm) // 32
                    for turn in fake.feed_audio(stream, stamp, pcm):
                        await ws.send_json({"type": "transcript.final", **turn})
                elif msg.get("text") == "control.drop":
                    fake.drop_session()
                    await ws.close(code=1011)
                    return
                elif msg.get("text") is not None and not configured:
                    configured = True
                    try:
                        first = json.loads(msg["text"])
                    except ValueError:
                        first = None
                    if isinstance(first, dict):
                        if first.get("stream") in ("tab", "mic"):
                            stream = first["stream"]
                        if isinstance(first.get("t0_ms"), int):
                            t0_ms = first["t0_ms"]
        except (WebSocketDisconnect, SessionDropped):
            return

    return app


def create_app(fixture_dir: str | Path) -> FastAPI:
    root = Path(fixture_dir)
    llm = create_llm_app(FakeLLM(
        load_llm_script(root / "llm_script.jsonl"),
        sleep_fn=lambda ms: time.sleep(ms / 1000),
    ))
    asr = create_asr_app(FakeASR(load_asr_script(root / "asr_script.jsonl")))
    llm.router.routes.extend(asr.router.routes)
    return llm


if __name__ == "__main__":
    import uvicorn

    fixture = os.environ.get("HALO_FIXTURE_DIR", "rig/fixtures/synthetic")
    uvicorn.run(create_app(fixture), host="127.0.0.1", port=18777)
