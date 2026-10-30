"""FakeASR engine: deterministic core of the Voice-realtime fake.

Feed it PCM frames stamped on the meeting clock; it returns transcript.final-
shaped turns once the audio position passes each scripted offset (plus the
latency knob). The WebSocket wire adapter lives in server.py.
"""

from __future__ import annotations

import uuid

from rig.fakes.scripts import AsrTurn

SAMPLE_RATE = 16000
BYTES_PER_MS = SAMPLE_RATE * 2 // 1000  # PCM16 mono


class SessionDropped(RuntimeError):
    pass


class FakeASR:
    def __init__(self, script: list[AsrTurn], latency_ms: int = 0):
        self._pending = sorted(script, key=lambda t: t.ts_start_ms)
        self.latency_ms = latency_ms
        self.dropped = False
        self._anchor: int | None = None  # ts_ms of the first frame seen
        self._position_ms = 0  # audio consumed since the anchor

    def drop_session(self) -> None:
        self.dropped = True

    def feed_audio(self, stream: str, ts_ms: int, pcm: bytes) -> list[dict]:
        if self.dropped:
            raise SessionDropped("FakeASR session dropped by knob")
        if self._anchor is None:
            self._anchor = ts_ms
        self._position_ms += len(pcm) // BYTES_PER_MS
        horizon = self._position_ms - self.latency_ms
        due = [t for t in self._pending if t.stream == stream and t.ts_start_ms <= horizon]
        self._pending = [t for t in self._pending if t not in due]
        return [self._emit(t) for t in due]

    def _emit(self, turn: AsrTurn) -> dict:
        anchor = self._anchor or 0
        return {
            "turn_id": str(uuid.uuid4()),
            "stream": turn.stream,
            "speaker": turn.speaker,
            "text": turn.text,
            "lang": turn.lang,
            "ts_start_ms": anchor + turn.ts_start_ms,
            "ts_end_ms": anchor + turn.ts_end_ms,
        }
