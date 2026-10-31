"""FakeTransport: FakeASR core behind the EngineTransport boundary.

Feeds meeting-clock frames into the core and translates its absolute turns
into offsets on this session's own audio position, like Voice
(audioProcessedMs counts the audio received, pads included, from 0 at each
open). One transport per stream.
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
        self._pos = 0  # audio ms received this session
        self._ts_at_zero: int | None = None  # browser ts at position 0, per the last real frame
        self._pending: list[dict[str, Any]] = []
        self.handshakes: list[dict[str, Any]] = []
        self.sent_frames = 0

    async def open(self, handshake: dict[str, Any]) -> None:
        self.handshakes.append(handshake)
        self._pos = 0  # like Voice: a new session counts audio from 0
        self._ts_at_zero = None

    async def send_audio(self, pcm: bytes, ts_ms: int = 0) -> None:
        if ts_ms:  # a real frame; pads carry no ts
            self._ts_at_zero = ts_ms - self._pos
        if self._ts_at_zero is None:
            self._ts_at_zero = 0
        due = self._fake.feed_audio(self._stream, ts_ms or self._ts_at_zero + self._pos, pcm)
        self._pos += len(pcm) // 32
        self.sent_frames += 1
        for turn in due:
            turn_id = str(uuid.uuid4())
            start = int(turn["ts_start_ms"]) - self._ts_at_zero
            end = int(turn["ts_end_ms"]) - self._ts_at_zero
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
