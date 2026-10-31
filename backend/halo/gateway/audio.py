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
import time
from typing import Any

from contracts.binary import AUDIO, MIC, REC, TAB, FrameError, parse_header

log = logging.getLogger("halo.gateway.audio")

SILENCE_100MS = bytes(3200)
MAX_PAD_FRAMES = 300  # the 30 s bound: 300 x 100 ms
FRAME_MS = 100


RESTART_JUMP_FRAMES = 50  # 5 s back = a new stream (hub restart), not a late frame


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
        self._owner: dict[int, int] = {TAB: -1, MIC: -1}  # producer id feeding each stream
        self._last_at: dict[int, float | None] = {TAB: None, MIC: None}  # monotonic, last frame queued
        self.gaps = 0
        self.padded = 0
        self.dropped = 0

    def audio_age_s(self) -> dict[str, float | None]:
        """Seconds since each stream last queued a frame (None: never)."""
        now = time.monotonic()
        return {name: None if self._last_at[s] is None else round(now - self._last_at[s], 1)
                for name, s in (("tab", TAB), ("mic", MIC))}

    @property
    def queues(self) -> dict[str, asyncio.Queue]:
        return {"tab": self._audio[TAB], "mic": self._audio[MIC], "rec": self._rec}

    def handle(self, frame: bytes, producer: int = 0) -> str:
        """Route one binary frame. Returns audio|rec|rejected|dropped.

        `producer` is the sending socket's id, increasing per socket. The
        newest producer owns each audio stream; older ones are dropped.
        """
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
        return self._enqueue_audio(head, frame, producer)

    def _enqueue_rec(self, head: dict[str, Any], frame: bytes) -> str:
        try:
            self._rec.put_nowait((head["seq"], head["ts_ms"], frame[head["header_size"]:]))
        except asyncio.QueueFull:
            self.dropped += 1
            log.warning("rec queue full, chunk dropped")
            return "dropped"
        return "rec"

    def _enqueue_audio(self, head: dict[str, Any], frame: bytes, producer: int) -> str:
        stream, seq, ts_ms = head["stream"], head["seq"], head["ts_ms"]
        queue = self._audio[stream]
        # Live 2026-10-31: repeat Starts left several sockets each sending mic
        # with its own seq. Interleaved, every frame looked like a gap, the
        # silence padding flooded Voice ("Audio backlog too large") and no
        # transcript came out. One producer per stream: the newest socket.
        if producer < self._owner[stream]:
            self.dropped += 1  # no log: an old socket sends 10 frames a second
            return "dropped"
        if producer > self._owner[stream]:
            if self._owner[stream] >= 0:  # a newer socket replaces one: its own seq
                log.warning("audio stream %s taken over by socket %s at seq %s", stream, producer, seq)
                self._next[stream], self._last_ts[stream] = seq, 0
            self._owner[stream] = producer
        expected = self._next[stream]
        if expected - seq > RESTART_JUMP_FRAMES:
            # Live 2026-10-31: a reloaded hub restarts at seq 0, and every
            # frame of the new meeting was dropped as "late". A big jump back
            # is a restarted stream, not a late frame: resync to it.
            log.warning("audio seq restarted (stream=%s seq=%s expected=%s), resyncing", stream, seq, expected)
            expected = self._next[stream] = seq
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
        self._last_at[stream] = time.monotonic()
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
