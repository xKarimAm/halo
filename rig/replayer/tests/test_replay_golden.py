"""Done case (1): the synthetic fixture replays (Mode A) and the golden
asserts pass. Runs against a stub Gateway that validates/dedupes/stores
per the ACK kit; the same Mode A + checker run against the real Gateway
once it lands (W1) — see STATE.md Open questions."""

from __future__ import annotations

from pathlib import Path

from contracts.binary import parse_header
from rig.replayer.checker import check
from rig.replayer.fixture import load_fixture
from rig.replayer.mode_a import ModeA
from rig.replayer.tests.test_replayer import StubGateway

FIXTURE = Path(__file__).parent.parent / "fixtures" / "synthetic"


def test_mode_a_synthetic_fixture_golden():
    fx = load_fixture(FIXTURE)
    gw = StubGateway()
    ModeA(fx, gw).run(fast=True)
    assert check(fx.expected, list(gw.rows.values())) == []
    assert gw.binary, "audio frames were sent"
    for frame in gw.binary:
        hdr = parse_header(frame)
        assert hdr["kind"] == 1 and hdr["stream"] in (0, 1)
