"""One Voice realtime session: pacer, clock map, reconnect, rotation.

A session paces PCM to the engine in real time, anchors the meeting clock on
the first frame it sees, maps engine turn offsets onto that clock, and pads
sequence gaps with silence. Transports implement EngineTransport; the fake
wraps FakeASR core, the real one speaks WebSocket.
"""

from __future__ import annotations

import asyncio
import logging
import math
import struct
import time
import uuid
from typing import Any

from halo.transcriber.protocol import ENDPOINTING, TurnAssembler, build_handshake

log = logging.getLogger("halo.transcriber")

FRAME_MS = 100
SILENCE_SLACK_MS = 300  # browser frame jitter tolerated before padding
BYTES_PER_MS = 32  # 16 kHz mono PCM16
ROTATION_AFTER_S = 59 * 60
SILENCE_RMS_THRESHOLD = 300.0  # PCM16 RMS below this counts as silence
SOFT_CUT_SILENCE_MS = 600  # pause length that soft-cuts an open turn
MIC_SILENT_ALERT_MS = 60_000  # one warning per silent run this long on the mic


class TransportError(RuntimeError):
    pass


class EngineTransport:
    """Boundary to one ASR engine session (fake or WS)."""

    async def open(self, handshake: dict[str, Any]) -> None:
        raise NotImplementedError

    async def send_audio(self, pcm: bytes, ts_ms: int = 0) -> None:
        raise NotImplementedError

    async def recv_event(self) -> dict[str, Any] | None:
        """Next server message, or None when nothing is waiting."""
        raise NotImplementedError

    async def close(self) -> None:
        raise NotImplementedError


class TranscriptionSession:
    """Owns one engine session for a single stream (tab or mic)."""

    def __init__(
        self,
        stream: str,
        mode: str,
        transport: EngineTransport,
        url: str = "",
        rotation_after_s: int = ROTATION_AFTER_S,
        soft_cut_silence_ms: int = SOFT_CUT_SILENCE_MS,
    ) -> None:
        self.stream = stream
        self.mode = mode
        self.transport = transport
        self.url = url
        self.rotation_after_s = rotation_after_s
        self.soft_cut_silence_ms = soft_cut_silence_ms
        self._silence_run_ms = 0
        # Audio position (position_ms scale, ≈ engine audioProcessedMs) where
        # the current silence run began; None while speech is arriving.
        self._silence_start_ms: int | None = None
        self._cut_this_pause = False
        self.speaker_override: str | None = "you" if mode == ENDPOINTING else None
        self.anchor_ms: int | None = None
        self.expected_seq: int | None = None
        self.position_ms = 0
        self.pad_ms = 0
        self.health = "ok"
        self.closed = False
        self.rotations = 0
        self._key = ""
        self._keywords: list[str] = []
        self._assembler = TurnAssembler()
        self._opened_at = 0.0
        self._streak = 0

    async def open(self, key: str, keywords: list[str] | None = None) -> None:
        self._key = key
        self._keywords = list(keywords or [])
        await self.transport.open(build_handshake(self.mode, key, keywords))
        self._opened_at = time.monotonic()
        self.health = "ok"

    async def feed_frame(self, seq: int, ts_ms: int, pcm: bytes) -> list[dict[str, Any]]:
        """Pace one queued frame through the engine; returns mapped turns."""
        if self.closed:
            return []
        if self.anchor_ms is None:
            self.anchor_ms = ts_ms
            self.expected_seq = seq
        assert self.expected_seq is not None
        if seq > self.expected_seq:
            gap = seq - self.expected_seq
            self.pad_ms += gap * FRAME_MS
            log.warning("transcriber seq gap: stream=%s expected=%d got=%d pad_ms=%d",
                        self.stream, self.expected_seq, seq, gap * FRAME_MS)
            await self._send_silence(gap * FRAME_MS)
        self.expected_seq = seq + 1
        frame_ms = len(pcm) // BYTES_PER_MS
        if self._rms(pcm) < SILENCE_RMS_THRESHOLD:
            if self._silence_run_ms == 0:
                self._silence_start_ms = self.position_ms
            self._silence_run_ms += frame_ms
            # Live 2026-10-31: Chrome used the wrong mic and nothing said so.
            if self.stream == "mic" and self._silence_run_ms - frame_ms < MIC_SILENT_ALERT_MS <= self._silence_run_ms:
                log.warning("transcriber mic silent for %d s (muted, or the wrong mic?)", MIC_SILENT_ALERT_MS // 1000)
        else:
            self._silence_run_ms = 0
            self._silence_start_ms = None
            self._cut_this_pause = False
        self.position_ms += frame_ms
        try:
            await self.transport.send_audio(pcm, ts_ms)
            turns = await self._drain()
            # One cut per pause (live check: cutting at every late partial
            # emitted single-word turns); speech resets the flag.
            if self._silence_run_ms >= self.soft_cut_silence_ms and not self._cut_this_pause:
                piece = self._assembler.maybe_cut(pause_start_ms=self._silence_start_ms)
                if piece is not None:
                    self._cut_this_pause = True
                    turns.append(self._map(piece))
            self._streak = 0
            self.health = "ok"
            return turns
        except Exception as exc:  # noqa: BLE001 -- any engine failure routes to reconnect/down
            await self._on_transport_error(exc)
            return []

    async def send_silence(self, ms: int = FRAME_MS) -> None:
        """Keep ingress real-time while the tab is quiet (no clock change)."""
        if self.closed or self.anchor_ms is None:
            return
        try:
            await self._send_silence(ms)
            self._streak = 0
            self.health = "ok"
        except Exception as exc:  # noqa: BLE001 -- any engine failure routes to reconnect/down
            await self._on_transport_error(exc)

    async def _send_silence(self, ms: int) -> None:
        await self.transport.send_audio(b"\x00" * (ms * BYTES_PER_MS))
        if self._silence_run_ms == 0:
            self._silence_start_ms = self.position_ms
        self.position_ms += ms
        self._silence_run_ms += ms

    @staticmethod
    def _rms(pcm: bytes) -> float:
        """RMS amplitude of PCM16 mono bytes (empty frame = silence)."""
        n = len(pcm) // 2
        if n == 0:
            return 0.0
        total = sum(s * s for s in struct.unpack("<" + "h" * n, pcm[: n * 2]))
        return math.sqrt(total / n)

    async def _drain(self) -> list[dict[str, Any]]:
        turns: list[dict[str, Any]] = []
        assert self.anchor_ms is not None
        while True:
            event = await self.transport.recv_event()
            if event is None:
                return turns
            completed = self._assembler.handle(event)
            if completed is not None:
                turns.append(self._map(completed))

    def _map(self, turn: dict[str, Any]) -> dict[str, Any]:
        assert self.anchor_ms is not None
        if turn.get("relative"):
            start = self.anchor_ms + int(turn.get("start_offset_ms", 0))
            end = self.anchor_ms + int(turn.get("end_offset_ms", 0))
        else:
            start = int(turn.get("start_offset_ms", 0))
            end = int(turn.get("end_offset_ms", 0))
        return {
            "turn_id": str(uuid.uuid4()),
            "stream": self.stream,
            "speaker": self.speaker_override or str(turn.get("speaker") or "?"),
            "text": str(turn.get("text", "")),
            "lang": str(turn.get("lang", "mixed")),
            "ts_start_ms": start,
            "ts_end_ms": end,
        }

    async def _on_transport_error(self, exc: Exception) -> None:
        # First consecutive failure: reconnect once. Any further consecutive
        # failure (reopen raised, or the next feed fails too): down, audio lost.
        self._streak += 1
        if self._streak > 1:
            self.health = "down"
            self.closed = True
            log.warning("transcriber session down: stream=%s error=%r", self.stream, exc)
            return
        self.health = "reconnecting"
        log.warning("transcriber session reconnecting: stream=%s error=%r", self.stream, exc)
        try:
            await self.transport.close()
            await self.transport.open(build_handshake(self.mode, self._key, self._keywords))
        except Exception as exc2:  # noqa: BLE001 -- reopen failure means the session is down
            self.health = "down"
            self.closed = True
            log.warning("transcriber session down: stream=%s error=%r", self.stream, exc2)

    async def maybe_rotate(self) -> bool:
        """Rotate to a fresh session before 60 min; labels reset (Correlator re-locks)."""
        if self.closed or self._opened_at == 0:
            return False
        if time.monotonic() - self._opened_at < self.rotation_after_s:
            return False
        log.warning("transcriber session rotating: stream=%s position_ms=%d",
                    self.stream, self.position_ms)
        try:
            await self.transport.close()
            await self.transport.open(build_handshake(self.mode, self._key, self._keywords))
        except Exception as exc:  # noqa: BLE001 -- rotation failure routes to reconnect/down
            await self._on_transport_error(exc)
            return False
        self._opened_at = time.monotonic()
        self.rotations += 1
        return True

    async def run(self, queue: asyncio.Queue, out: asyncio.Queue) -> None:
        """Pump queued frames until closed; silence keeps ingress real-time."""
        # Live 2026-10-31: padding silence on every 100 ms queue wait added it
        # ON TOP of jittery browser frames, so ingress ran faster than real
        # time and Voice closed with 1008 "Audio backlog too large". Pad only
        # when the audio sent is really behind the wall clock.
        started = time.monotonic()
        sent_ms = 0
        while not self.closed:
            await self.maybe_rotate()
            try:
                frame = await asyncio.wait_for(queue.get(), timeout=FRAME_MS / 1000)
            except TimeoutError:
                if sent_ms + FRAME_MS <= (time.monotonic() - started) * 1000 - SILENCE_SLACK_MS:
                    await self.send_silence()
                    sent_ms += FRAME_MS
                continue
            # Gateway AudioRouter enqueues (seq, ts_ms, payload) tuples.
            seq, ts_ms, pcm = frame if isinstance(frame, tuple) else (
                frame["seq"], frame["ts_ms"], frame["pcm"])
            sent_ms += len(pcm) // BYTES_PER_MS
            for turn in await self.feed_frame(seq, ts_ms, pcm):
                out.put_nowait(turn)

    async def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            await self.transport.close()
        except Exception:
            log.exception("transcriber session close failed: stream=%s", self.stream)
