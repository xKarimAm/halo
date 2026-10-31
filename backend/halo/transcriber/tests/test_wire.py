"""Wire test: WsTransport against the fake Voice WS server (localhost only).

Asserts plumbing (connect, handshake, binary audio in, transcript.final
JSON out). Timestamps assert monotonic receipt only: the fake server stamps
the wall clock, not the meeting clock (rig gap, filed as an issue).
"""

from __future__ import annotations

import asyncio
import threading
import time

import uvicorn
from halo.transcriber.protocol import DIARIZATION, build_handshake
from halo.transcriber.transport import WsTransport

from rig.fakes.fake_asr import FakeASR
from rig.fakes.scripts import AsrTurn
from rig.fakes.server import create_asr_app

PORT = 18799
FRAME = b"\x01\x02" * 1600


def test_ws_roundtrip_plumbing():
    fake = FakeASR([AsrTurn(stream="tab", speaker="A", text="Hello there.", lang="en",
                            ts_start_ms=100, ts_end_ms=500)])
    config = uvicorn.Config(create_asr_app(fake), host="127.0.0.1", port=PORT, log_level="error")
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
            got: dict | None = None
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline and got is None:
                message = await transport.recv_event()
                if message and message.get("type") == "transcript.final":
                    got = message
            await transport.close()
            return got

        got = asyncio.run(client())
        assert got is not None, "no transcript.final from the fake server"
        assert got["speaker"] == "A"
        assert got["text"] == "Hello there."
    finally:
        server.should_exit = True
        thread.join(timeout=15)
