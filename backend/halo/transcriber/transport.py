"""WebSocket transport to Muse Voice Transcribe realtime."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import websockets

from halo.transcriber.session import EngineTransport, TransportError

log = logging.getLogger("halo.transcriber")


class WsTransport(EngineTransport):
    """One WS connection. Handshake is the first JSON frame (never a header)."""

    def __init__(self, url: str) -> None:
        self.url = url
        self._ws: Any = None

    async def open(self, handshake: dict[str, Any]) -> None:
        try:
            self._ws = await websockets.connect(self.url, max_size=1 << 20)
            await self._ws.send(json.dumps(handshake))
        except Exception as exc:
            raise TransportError(f"voice connect failed: {exc!r}") from exc

    async def send_audio(self, pcm: bytes, ts_ms: int = 0) -> None:
        if self._ws is None:
            raise TransportError("voice session not open")
        try:
            await self._ws.send(pcm)
        except Exception as exc:
            raise TransportError(f"voice send failed: {exc!r}") from exc

    async def recv_event(self) -> dict[str, Any] | None:
        if self._ws is None:
            return None
        try:
            message = await asyncio.wait_for(self._ws.recv(), timeout=0.05)
        except TimeoutError:
            return None
        except Exception as exc:
            raise TransportError(f"voice recv failed: {exc!r}") from exc
        if isinstance(message, bytes):
            return None
        try:
            parsed = json.loads(message)
        except ValueError:
            return None
        return parsed if isinstance(parsed, dict) else None

    async def close(self) -> None:
        ws, self._ws = self._ws, None
        if ws is None:
            return
        try:
            await ws.close()
        except Exception:
            log.exception("voice close failed")
