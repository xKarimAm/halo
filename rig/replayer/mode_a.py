"""Mode A (fake extension): plays a fixture to a Gateway-shaped transport.

Envelopes and binary audio go out at their fixture ts on one timeline.
A missing ACK (transport returns None) resends the same envelope id, up
to 3 tries. `fast=True` runs the virtual clock: same sends, no sleeping.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from contracts.binary import pack_audio
from rig.replayer.fixture import Fixture

FRAME_MS = 100
FRAME_BYTES = 1600 * 2  # 100 ms of 16 kHz mono PCM16


class ModeA:
    def __init__(self, fixture: Fixture, transport: Any):
        self.fixture = fixture
        self.transport = transport  # send_envelope(env) -> ack|None, send_binary(bytes)

    def run(self, fast: bool = True, sleep_fn: Callable[[int], None] | None = None) -> None:
        t0 = int(self.fixture.meta["t0_ms"])
        timeline: list[tuple[int, int, Any]] = []
        for env in self.fixture.envelopes:
            timeline.append((int(env["ts_ms"]), 0, env))
        for stream, pcm in ((0, self.fixture.tab_pcm), (1, self.fixture.mic_pcm)):
            for i in range(0, len(pcm), FRAME_BYTES):
                offset = (i // FRAME_BYTES) * FRAME_MS
                timeline.append((offset, 1, pack_audio(stream, i // FRAME_BYTES, t0 + offset, pcm[i:i + FRAME_BYTES])))
        timeline.sort(key=lambda item: (item[0], item[1]))
        last = 0
        for offset, kind, payload in timeline:
            if not fast and sleep_fn is not None and offset > last:
                sleep_fn(offset - last)
            last = offset
            if kind == 0:
                self._send(payload)
            else:
                self.transport.send_binary(payload)

    def _send(self, env_with_ts: dict) -> None:
        env = {k: v for k, v in env_with_ts.items() if k != "ts_ms"}
        for _ in range(3):
            ack = self.transport.send_envelope(env)
            if ack is not None:
                return
