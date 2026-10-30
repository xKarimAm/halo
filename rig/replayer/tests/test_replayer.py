"""Replayer Done cases (2)-(6) plus Mode B; the golden (case 1) lives in
test_replay_golden.py. Seams: ModeA.run / ModeB.run / checker / obs convert."""

from __future__ import annotations

import json
import wave
from pathlib import Path

from rig.replayer.checker import check, normalise
from rig.replayer.fixture import load_fixture
from rig.replayer.mode_a import ModeA
from rig.replayer.mode_b import ModeB
from rig.replayer.obs import convert_obs_pair

FIXTURE = Path(__file__).parent.parent / "fixtures" / "synthetic"


class StubGateway:
    """Validates, dedupes by envelope id, stores one row per id (ACK kit)."""

    def __init__(self, drop_first_ack_for: str | None = None):
        self.rows: dict[str, dict] = {}
        self.drop_first_ack_for = drop_first_ack_for
        self._dropped = False
        self.binary: list[bytes] = []

    def send_envelope(self, env: dict) -> dict | None:
        self.rows.setdefault(env["id"], env)
        if env["id"] == self.drop_first_ack_for and not self._dropped:
            self._dropped = True
            return None  # dropped ACK: sender must resend the same id
        return {"ack_of": env["id"], "status": "ok"}

    def send_binary(self, frame: bytes) -> None:
        self.binary.append(frame)


# (2) Drop an ACK -> resend same id; duplicate -> one stored row
def test_drop_ack_resends_same_id_and_duplicate_stores_once():
    fx = load_fixture(FIXTURE)
    first = fx.envelopes[0]["id"]
    gw = StubGateway(drop_first_ack_for=first)
    ModeA(fx, gw).run(fast=True)
    assert list(gw.rows).count(first) == 1 and len(gw.rows) == len(fx.envelopes)
    gw.send_envelope(fx.envelopes[0])  # duplicate delivery
    assert len(gw.rows) == len(fx.envelopes)


# (3) Checker teeth
def test_checker_teeth():
    fx = load_fixture(FIXTURE)
    actual = [e for e in fx.envelopes]
    assert check(fx.expected, actual) == []
    mutated = json.loads(json.dumps(fx.expected))
    mutated[0]["ts_ms"] += 1000  # 1 s off: beyond ±300 ms
    assert check(mutated, actual) != []
    swapped = json.loads(json.dumps(fx.expected))
    same_tile = [i for i, e in enumerate(swapped) if e.get("tile_id") == "tile-1"]
    if len(same_tile) >= 2:
        swapped[same_tile[0]], swapped[same_tile[1]] = swapped[same_tile[1]], swapped[same_tile[0]]
        assert check(swapped, actual) != []
    different_ids = json.loads(json.dumps(actual))
    for e in different_ids:
        e["id"] = "99999999-9999-4999-8999-999999999999"
    assert check(fx.expected, different_ids) == []  # ids ignored
    assert normalise("Hello,  WORLD!") == "hello world"


# (4) Fast virtual-clock replay: identical assert results, no real waiting
def test_virtual_clock_matches_realtime_results():
    fx = load_fixture(FIXTURE)
    gw_fast, gw_slow = StubGateway(), StubGateway()
    ModeA(fx, gw_fast).run(fast=True)
    ModeA(fx, gw_slow).run(fast=False, sleep_fn=lambda ms: None)
    assert check(fx.expected, list(gw_fast.rows.values())) == []
    assert list(gw_fast.rows) == list(gw_slow.rows)


# Mode B: recorded backend -> extension events reach the sink in ts order
def test_mode_b_replays_in_order():
    fx = load_fixture(FIXTURE)
    got: list[dict] = []
    ModeB(fx, got.append).run()
    assert [g["type"] for g in got] == [e["type"] for e in fx.envelopes]


# (5) OBS converter: WAV pair -> tab.pcm/mic.pcm + starter asr_script.jsonl
def test_obs_converter(tmp_path):
    for name in ("desktop", "mic"):
        with wave.open(str(tmp_path / f"{name}.wav"), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(b"\x01\x00" * 1600)
    out = convert_obs_pair(tmp_path / "desktop.wav", tmp_path / "mic.wav", tmp_path / "fixture")
    assert (out / "tab.pcm").read_bytes() == b"\x01\x00" * 1600
    assert (out / "mic.pcm").read_bytes() == b"\x01\x00" * 1600
    rows = [json.loads(l) for l in (out / "asr_script.jsonl").read_text().splitlines() if l.strip()]
    assert rows and rows[0]["stream"] in ("tab", "mic")
