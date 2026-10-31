"""Recorder tests: replayed rec chunks -> file + index (PLAN cases 1-5)."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid

from halo.bus import Bus
from halo.recorder import Recorder

MEETING = "33333333-3333-4333-8333-333333333333"
T0 = 1760000000000


def _env(type_, mid, data):
    return {
        "specversion": "1.0", "id": str(uuid.uuid4()), "type": type_,
        "source": "halo/test", "time": "2026-10-31T09:00:00Z",
        "meetingid": mid, "datacontenttype": "application/json", "data": data,
    }


def _started(mid=MEETING, t0=T0):
    return _env("meeting.started", mid, {
        "meeting_id": mid, "platform": "meet", "meeting_code": "abc-defg-hij",
        "t0_ms": t0, "self_name": "Karim"})


def _ended(mid=MEETING):
    return _env("meeting.ended", mid, {"reason": "left"})


def pub(bus, envelope):
    asyncio.run(bus.publish(envelope))


def make_rec(tmp_path, **kwargs):
    data = tmp_path / "data"
    data.mkdir(parents=True, exist_ok=True)
    bus = Bus()
    rec = Recorder(bus, data_dir=data, **kwargs)
    return rec, bus, data


def test_chunks_append_in_seq_order_with_index(tmp_path):
    rec, bus, data = make_rec(tmp_path)
    pub(bus, _started())
    rec.ingest((0, T0 + 1000, b"aaa"))
    rec.ingest((1, T0 + 2000, b"bb"))
    rec.ingest((2, T0 + 3000, b"c"))
    rec.flush_all()
    assert (data / "recordings" / f"{MEETING}.webm").read_bytes() == b"aaabbc"
    sidecar = json.loads(
        (data / "recordings" / f"{MEETING}.index.json").read_text())
    assert sidecar["meeting_id"] == MEETING and sidecar["t0_ms"] == T0
    assert sidecar["files"][0]["path"] == f"recordings/{MEETING}.webm"
    assert sidecar["files"][0]["start_ts_ms"] == T0 + 1000
    assert sidecar["files"][0]["chunks"] == [
        [T0 + 1000, 0], [T0 + 2000, 3], [T0 + 3000, 5]]


def test_disk_lag_spills_to_temp_then_drains(tmp_path):
    rec, bus, data = make_rec(tmp_path, max_staging_bytes=4)
    pub(bus, _started())
    rec.ingest((0, T0 + 1000, b"aaa"))
    rec.ingest((1, T0 + 2000, b"bb"))
    rec.ingest((2, T0 + 3000, b"c"))
    spill = data / "recordings" / f"{MEETING}.spill"
    assert spill.exists()
    rec.flush_all()
    assert (data / "recordings" / f"{MEETING}.webm").read_bytes() == b"aaabbc"
    assert not spill.exists()
    sidecar = json.loads((data / "recordings" / f"{MEETING}.index.json").read_text())
    assert sidecar["files"][0]["chunks"] == [
        [T0 + 1000, 0], [T0 + 2000, 3], [T0 + 3000, 5]]


def test_write_error_keeps_data_for_retry(tmp_path):
    calls = []

    def flaky_open(path, mode):
        calls.append(mode)
        if len(calls) == 1:
            raise OSError("disk busy")
        return open(path, mode)

    rec, bus, data = make_rec(tmp_path, file_opener=flaky_open)
    pub(bus, _started())
    rec.ingest((0, T0 + 1000, b"aaa"))
    rec.flush_all()  # write fails; data must survive in spill
    assert (data / "recordings" / f"{MEETING}.spill").exists()
    rec.flush_all()  # retry succeeds
    assert (data / "recordings" / f"{MEETING}.webm").read_bytes() == b"aaa"


def test_ended_finalizes_exactly_once(tmp_path):
    rec, bus, data = make_rec(tmp_path)
    pub(bus, _started())
    rec.ingest((0, T0 + 1000, b"aaa"))
    pub(bus, _ended())
    page = data / "recordings" / f"{MEETING}.webm"
    assert page.read_bytes() == b"aaa"
    sidecar = data / "recordings" / f"{MEETING}.index.json"
    assert sidecar.exists()
    before = sidecar.read_bytes()
    pub(bus, _ended())
    assert sidecar.read_bytes() == before
    rec.ingest((1, T0 + 2000, b"late"))
    rec.flush_all()
    assert page.read_bytes() == b"aaa"


def test_mid_meeting_start_uses_file_start(tmp_path):
    rec, bus, data = make_rec(tmp_path)
    pub(bus, _started())
    rec.ingest((0, T0 + 30000, b"aaa"))
    rec.ingest((1, T0 + 31000, b"bb"))
    rec.flush_all()
    files = json.loads(
        (data / "recordings" / f"{MEETING}.index.json").read_text())["files"]
    assert files[0]["start_ts_ms"] == T0 + 30000
    path, offset = rec.covering_file(MEETING, T0 + 30500)
    assert path == f"recordings/{MEETING}.webm"
    assert offset == 500  # ts - covering-file start, not t0


def test_gap_splits_covering_file(tmp_path):
    rec, bus, data = make_rec(tmp_path)
    pub(bus, _started())
    rec.ingest((0, T0 + 1000, b"aaa"))
    rec.ingest((1, T0 + 61000, b"bb"))  # 60 s ts gap: switch off/on
    rec.flush_all()
    files = json.loads(
        (data / "recordings" / f"{MEETING}.index.json").read_text())["files"]
    assert [f["path"] for f in files] == [
        f"recordings/{MEETING}.webm", f"recordings/{MEETING}.2.webm"]
    assert files[1]["start_ts_ms"] == T0 + 61000
    assert (data / "recordings" / f"{MEETING}.2.webm").read_bytes() == b"bb"


def test_unknown_meeting_chunks_dropped(tmp_path, caplog):
    rec, _, data = make_rec(tmp_path)
    with caplog.at_level(logging.WARNING, logger="halo.recorder"):
        rec.ingest((0, T0 + 1000, b"aaa"))
    assert "drop" in caplog.text
    assert not (data / "recordings").exists() or not list(
        (data / "recordings").iterdir())


def test_background_loop_drains_queue(tmp_path):
    async def drive():
        queue: asyncio.Queue = asyncio.Queue()
        rec, bus, data = make_rec(tmp_path, rec_queue=queue)
        await bus.publish(_started())
        rec.start()
        await queue.put((0, T0 + 1000, b"aaa"))
        await queue.put((1, T0 + 2000, b"bb"))
        for _ in range(100):
            if (data / "recordings" / f"{MEETING}.webm").exists() and (
                    data / "recordings" / f"{MEETING}.webm"
            ).read_bytes() == b"aaabb":
                break
            await asyncio.sleep(0.05)
        rec.stop()
        return (data / "recordings" / f"{MEETING}.webm").read_bytes()

    assert asyncio.run(drive()) == b"aaabb"


def test_replayed_started_keeps_live_meeting(tmp_path):
    """Issue #57: a repeated meeting.started for a live meeting keeps it
    live with its first t0 (no second meeting, no finalize)."""
    rec, bus, _ = make_rec(tmp_path)
    started = _started()
    pub(bus, started)
    pub(bus, {**started, "data": {**started["data"], "t0_ms": T0 + 999}})
    assert list(rec._meetings) == [MEETING]
    assert rec._meetings[MEETING].t0_ms == T0
    assert not rec._meetings[MEETING].finalized
