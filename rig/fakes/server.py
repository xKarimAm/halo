"""Wire adapters: FakeLLM as an OpenAI-compatible HTTP app, FakeASR as a
Voice-shaped WebSocket. Run: `uv run python -m rig.fakes.server` (needs a
fixture dir via HALO_FIXTURE_DIR with asr_script.jsonl / llm_script.jsonl).
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketDisconnected

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


def create_asr_app(script: list) -> FastAPI:
    """One FakeASR per connection (issue #23): the handshake mode routes the
    session (DIARIZATION -> tab, ENDPOINTING -> mic), and turns go out as
    real Voice lifecycle shapes on script offsets from the session anchor:
    int turnIds, `transcript` partials without turnId, the `speaker` label
    at the END of the turn, and one turn per scripted (speaker-change) turn
    so the joined gate takes the transcriber's soft-cut path."""
    app = FastAPI()

    @app.websocket("/v1/voice/realtime")
    async def realtime(ws: WebSocket) -> None:
        await ws.accept()
        fake = FakeASR(list(script))
        stream = "tab"
        turn_seq = 0
        open_turns: dict[int, dict] = {}
        try:
            while True:
                msg = await ws.receive()
                if msg.get("type") == "websocket.disconnect":
                    return
                if msg.get("bytes") is not None:
                    for turn in fake.feed_audio(stream, int(time.time() * 1000), msg["bytes"]):
                        anchor = fake.anchor_ms
                        tid = turn_seq
                        turn_seq += 1
                        open_turns[tid] = turn
                        await ws.send_json({"type": "speechStart", "turnId": tid,
                                            "audioProcessedMs": turn["ts_start_ms"] - anchor})
                        await ws.send_json({"type": "transcript", "transcript": turn["text"],
                                            "final": False,
                                            "audioProcessedMs": turn["ts_end_ms"] - anchor})
                    anchor = fake.anchor_ms
                    horizon = fake.position_ms - fake.latency_ms
                    for tid in [tid for tid, turn in open_turns.items()
                                if turn["ts_end_ms"] - anchor <= horizon]:
                        turn = open_turns.pop(tid)
                        end = turn["ts_end_ms"] - anchor
                        await ws.send_json({"type": "speaker", "label": turn["speaker"],
                                            "audioProcessedMs": end})
                        await ws.send_json({"type": "speechEnd", "turnId": tid,
                                            "audioProcessedMs": end})
                        await ws.send_json({"type": "speechComplete", "turnId": tid,
                                            "transcript": turn["text"],
                                            "audioProcessedMs": end})
                elif msg.get("text") == "control.drop":
                    fake.drop_session()
                    await ws.close(code=1011)
                    return
                elif msg.get("text"):
                    try:
                        mode = json.loads(msg["text"]).get("mode")
                    except (ValueError, AttributeError):
                        mode = None
                    if mode == "ENDPOINTING":
                        stream = "mic"
                    elif mode == "DIARIZATION":
                        stream = "tab"
        except (WebSocketDisconnect, WebSocketDisconnected, SessionDropped):
            return

    return app


def create_app(fixture_dir: str | Path) -> FastAPI:
    root = Path(fixture_dir)
    llm = create_llm_app(FakeLLM(
        load_llm_script(root / "llm_script.jsonl"),
        sleep_fn=lambda ms: time.sleep(ms / 1000),
    ))
    asr = create_asr_app(load_asr_script(root / "asr_script.jsonl"))
    llm.router.routes.extend(asr.router.routes)
    return llm


if __name__ == "__main__":
    import uvicorn

    fixture = os.environ.get("HALO_FIXTURE_DIR", "rig/fixtures/synthetic")
    uvicorn.run(create_app(fixture), host="127.0.0.1", port=18777)
