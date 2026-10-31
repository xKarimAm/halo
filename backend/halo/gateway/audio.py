"""Binary data-plane routing (no envelope, no ACK).

kind=1 audio lands on the tab/mic queue in order; kind=3 rec chunks on the rec
queue; kind=2 is rejected. A seq gap is silence-padded (3200 zero bytes =
100 ms of PCM16 mono 16 kHz) and logged, capped at 300 frames (the 30 s
bound), then the stream resyncs. Late frames are dropped. Full queues drop
newest. Items are `(seq, ts_ms, payload)` tuples, wired to Transcriber /
Recorder by the composition root.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from contracts.binary import AUDIO, MIC, REC, TAB, FrameError, parse_header

log = logging.getLogger("halo.gateway.audio")

SILENCE_100MS = bytes(3200)
MAX_PAD_FRAMES = 300  # the 30 s bound: 300 x 100 ms
FRAME_MS = 100


class AudioRouter:
    def __init__(
        self,
        audio_tab: asyncio.Queue | None = None,
        audio_mic: asyncio.Queue | None = None,
        rec: asyncio.Queue | None = None,
    ) -> None:
        self._audio: dict[int, asyncio.Queue] = {
            TAB: audio_tab or asyncio.Queue(maxsize=200),
            MIC: audio_mic or asyncio.Queue(maxsize=200),
        }
        self._rec = rec or asyncio.Queue(maxsize=200)
        self._next: dict[int, int] = {TAB: 0, MIC: 0}
        self._last_ts: dict[int, int] = {TAB: 0, MIC: 0}
        self.gaps = 0
        self.padded = 0
        self.dropped = 0

    @property
    def queues(self) -> dict[str, asyncio.Queue]:
        return {"tab": self._audio[TAB], "mic": self._audio[MIC], "rec": self._rec}

    def handle(self, frame: bytes) -> str:
        """Route one binary frame. Returns audio|rec|rejected|dropped."""
        try:
            head = parse_header(frame)
        except FrameError as exc:
            log.warning("binary frame rejected: %s", exc)
            return "rejected"
        if head["kind"] == REC:
            return self._enqueue_rec(head, frame)
        if head["kind"] != AUDIO or head["stream"] not in self._audio:
            log.warning("binary frame rejected: unknown audio stream")
            return "rejected"
        return self._enqueue_audio(head, frame)

    def _enqueue_rec(self, head: dict[str, Any], frame: bytes) -> str:
        try:
            self._rec.put_nowait((head["seq"], head["ts_ms"], frame[head["header_size"]:]))
        except asyncio.QueueFull:
            self.dropped += 1
            log.warning("rec queue full, chunk dropped")
            return "dropped"
        return "rec"

    def _enqueue_audio(self, head: dict[str, Any], frame: bytes) -> str:
        stream, seq, ts_ms = head["stream"], head["seq"], head["ts_ms"]
        queue = self._audio[stream]
        expected = self._next[stream]
        if seq < expected:
            self.dropped += 1
            log.warning("late audio frame dropped (stream=%s seq=%s expected=%s)", stream, seq, expected)
            return "dropped"
        if seq > expected:
            self._pad_gap(queue, stream, expected, seq, ts_ms)
        payload = frame[head["header_size"]:]
        try:
            queue.put_nowait((seq, ts_ms, payload))
        except asyncio.QueueFull:
            self.dropped += 1
            log.warning("audio queue full, frame dropped (stream=%s seq=%s)", stream, seq)
            return "dropped"
        self._next[stream] = seq + 1
        self._last_ts[stream] = ts_ms
        return "audio"

    def _pad_gap(self, queue: asyncio.Queue, stream: int, expected: int, seq: int, ts_ms: int) -> None:
        missing = seq - expected
        pad = min(missing, MAX_PAD_FRAMES)
        self.gaps += 1
        self.padded += pad
        base = self._last_ts[stream] or (ts_ms - FRAME_MS * missing)
        for i in range(pad):
            try:
                queue.put_nowait((expected + i, base + FRAME_MS * (i + 1), SILENCE_100MS))
            except asyncio.QueueFull:
                self.dropped += 1
                break
        if missing > MAX_PAD_FRAMES:
            log.warning("audio gap over the 30 s bound (stream=%s missing=%s), resyncing", stream, missing)
        else:
            log.warning("audio gap padded with silence (stream=%s missing=%s)", stream, missing)
