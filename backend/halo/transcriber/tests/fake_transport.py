"""FakeTransport: FakeASR core behind the EngineTransport boundary.

Feeds meeting-clock frames into the core and translates its absolute turns
into relative-offset protocol messages, so sessions map clocks exactly like
production (anchor + offset). One transport per stream.
"""

from __future__ import annotations

import uuid
from typing import Any

from halo.transcriber.session import EngineTransport

from rig.fakes.fake_asr import FakeASR


class FakeTransport(EngineTransport):
    def __init__(self, fake: FakeASR, stream: str) -> None:
        self._fake = fake
        self._stream = stream
        self._anchor: int | None = None
        self._pending: list[dict[str, Any]] = []
        self.handshakes: list[dict[str, Any]] = []
        self.sent_frames = 0

    async def open(self, handshake: dict[str, Any]) -> None:
        self.handshakes.append(handshake)

    async def send_audio(self, pcm: bytes, ts_ms: int = 0) -> None:
        if self._anchor is None:
            self._anchor = ts_ms
        assert self._anchor is not None
        due = self._fake.feed_audio(self._stream, ts_ms or self._anchor, pcm)
        self.sent_frames += 1
        for turn in due:
            turn_id = str(uuid.uuid4())
            start = int(turn["ts_start_ms"]) - self._anchor
            end = int(turn["ts_end_ms"]) - self._anchor
            # Cumulative partials first (no final flag); speechComplete carries
            # the offsets and completes, mirroring the real turn lifecycle.
            self._pending.extend([
                {"type": "speechStart", "turnId": turn_id},
                {"type": "speaker", "turnId": turn_id, "speaker": turn["speaker"]},
                {"type": "partial", "turnId": turn_id, "text": turn["text"][:10]},
                {"type": "partial", "turnId": turn_id, "text": turn["text"]},
                {
                    "type": "speechComplete",
                    "turnId": turn_id,
                    "startMs": start,
                    "endMs": end,
                    "lang": turn["lang"],
                },
            ])

    async def recv_event(self) -> dict[str, Any] | None:
        if not self._pending:
            return None
        return self._pending.pop(0)

    async def close(self) -> None:
        pass
