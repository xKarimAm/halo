"""Wire test: WsTransport against the fake Voice WS server (localhost only).

Asserts plumbing (connect, handshake, binary audio in, Voice lifecycle
events out on script offsets: speechStart/speaker/partial/speechComplete).
"""

from __future__ import annotations

import asyncio
import threading
import time

import uvicorn
from halo.transcriber.protocol import DIARIZATION, build_handshake
from halo.transcriber.transport import WsTransport

from rig.fakes.scripts import AsrTurn
from rig.fakes.server import create_asr_app

PORT = 18799
FRAME = b"\x01\x02" * 1600


def test_ws_roundtrip_plumbing():
    script = [AsrTurn(stream="tab", speaker="A", text="Hello there.", lang="en",
                      ts_start_ms=100, ts_end_ms=500)]
    config = uvicorn.Config(create_asr_app(script), host="127.0.0.1", port=PORT, log_level="error")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 15
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.05)
        assert server.started, "fake voice server did not start"

        async def client() -> dict | None:
            transport = WsTransport(f"ws://127.0.0.1:{PORT}/v1/voice/realtime")
            await transport.open(build_handshake(DIARIZATION, "fake-key"))
            for _ in range(8):
                await transport.send_audio(FRAME)
            events: list[dict] = []
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                message = await transport.recv_event()
                if message:
                    events.append(message)
                if any(e.get("type") == "speechComplete" for e in events):
                    break
            await transport.close()
            return events

        events = asyncio.run(client())
        types = [e.get("type") for e in events]
        assert "speechComplete" in types, f"no speechComplete from the fake server: {types}"
        assert next(e for e in events if e["type"] == "speaker")["speaker"] == "A"
        assert next(e for e in events if e["type"] == "partial")["text"] == "Hello there."
        complete = next(e for e in events if e["type"] == "speechComplete")
        assert complete["startMs"] == 100 and complete["endMs"] == 500
    finally:
        server.should_exit = True
        thread.join(timeout=15)
