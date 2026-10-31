"""Transcriber: binary audio in, transcript.final envelopes out.

Two engine sessions (tab = diarization, mic = endpointing as "you") fed
from the bounded Gateway queues. Finals only. Both sessions close on the
first meeting.ended per meeting_id.
"""

from __future__ import annotations

import asyncio
import datetime
import logging
import uuid
from collections.abc import Callable
from typing import Any

from contracts.binary import TAB, FrameError, parse_header
from halo.transcriber.protocol import DIARIZATION, ENDPOINTING
from halo.transcriber.session import EngineTransport, TranscriptionSession

log = logging.getLogger("halo.transcriber")

Envelope = dict[str, Any]


def _utcnow() -> str:
    return datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z")


class Transcriber:
    def __init__(
        self,
        bus: Any,
        queue_tab: asyncio.Queue,
        queue_mic: asyncio.Queue,
        make_transport: Callable[[str, str], EngineTransport],
        key: str = "",
        keywords: list[str] | None = None,
    ) -> None:
        self._bus = bus
        self._queues = {"tab": queue_tab, "mic": queue_mic}
        self._make_transport = make_transport
        self._key = key
        self._keywords = list(keywords or [])
        self._sessions: dict[str, TranscriptionSession] = {}
        self._out: asyncio.Queue = asyncio.Queue()
        self._active: str | None = None
        self._closed: set[str] = set()
        self.close_calls = 0
        bus.subscribe("meeting.started", self._on_started)
        bus.subscribe("meeting.ended", self._on_ended)
        bus.subscribe("meeting.context", self._on_context)
        bus.register_health("asr", self.health_status)

    # -- bus -----------------------------------------------------------

    async def _on_context(self, envelope: Envelope) -> None:
        data = envelope.get("data", {})
        terms = [str(data.get("subject", ""))]
        terms.extend(str(a) for a in data.get("agenda", []))
        terms.extend(str(r.get("name", "")) for r in data.get("roles", []))
        self._keywords = [t for t in terms if t][:20]
        # The hub sends meeting.context after meeting.started, so the open
        # sessions handshook without these terms.
        if envelope.get("meetingid") == self._active:
            for session in self._sessions.values():
                session.set_keywords(self._keywords)

    async def _on_started(self, envelope: Envelope) -> None:
        meeting_id = str(envelope.get("data", {}).get("meeting_id", ""))
        if not meeting_id or meeting_id == self._active or meeting_id in self._closed:
            return
        self._active = meeting_id
        self._sessions = {
            "tab": TranscriptionSession("tab", DIARIZATION, self._make_transport("tab", DIARIZATION)),
            "mic": TranscriptionSession("mic", ENDPOINTING, self._make_transport("mic", ENDPOINTING)),
        }
        for stream, session in self._sessions.items():
            await session.open(self._key, self._keywords)
            asyncio.get_running_loop().create_task(
                session.run(self._queues[stream], self._out), name=f"halo-transcriber-{stream}"
            )
        asyncio.get_running_loop().create_task(self._pump(), name="halo-transcriber-pump")

    async def _on_ended(self, envelope: Envelope) -> None:
        meeting_id = str(envelope.get("meetingid") or "")
        if not meeting_id or meeting_id in self._closed:
            return
        self._closed.add(meeting_id)
        if meeting_id != self._active:
            return
        for session in self._sessions.values():
            await session.close()
            self.close_calls += 1
        self._sessions = {}
        self._active = None

    async def _pump(self) -> None:
        while True:
            turn = await self._out.get()
            if self._active is None:
                continue
            await self._bus.publish({
                "specversion": "1.0",
                "id": str(uuid.uuid4()),
                "type": "transcript.final",
                "source": "halo/transcriber",
                "time": _utcnow(),
                "meetingid": self._active,
                "datacontenttype": "application/json",
                "data": {
                    "turn_id": turn["turn_id"],
                    "stream": turn["stream"],
                    "speaker": turn["speaker"],
                    "text": turn["text"],
                    "lang": turn["lang"],
                    "ts_start_ms": turn["ts_start_ms"],
                    "ts_end_ms": turn["ts_end_ms"],
                },
            })

    def health_status(self) -> str:
        states = [s.health for s in self._sessions.values()]
        if "down" in states:
            return "down"
        if "reconnecting" in states:
            return "reconnecting"
        return "ok"

    # -- queue input ---------------------------------------------------

    @staticmethod
    def parse_frame(raw: bytes) -> dict[str, Any]:
        """Split one Gateway audio frame into seq/ts/pcm (kind=1 only)."""
        header = parse_header(raw)
        if header["kind"] != 1:
            raise FrameError(f"not audio: kind={header['kind']}")
        return {
            "stream": "tab" if header["stream"] == TAB else "mic",
            "seq": header["seq"],
            "ts_ms": header["ts_ms"],
            "pcm": raw[header["header_size"]:],
        }
