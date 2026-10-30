"""Mode B (fake backend): replays recorded backend -> extension events to
a sink (the real extension on the Fake Meet page) in fixture ts order."""

from __future__ import annotations

from collections.abc import Callable

from rig.replayer.fixture import Fixture


class ModeB:
    def __init__(self, fixture: Fixture, sink: Callable[[dict], None]):
        self.fixture = fixture
        self.sink = sink

    def run(self) -> None:
        for env in sorted(self.fixture.envelopes, key=lambda e: int(e["ts_ms"])):
            self.sink({k: v for k, v in env.items() if k != "ts_ms"})
