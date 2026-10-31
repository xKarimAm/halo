"""Correlator tests: scripted bus sequences in, attributed turns out."""

from __future__ import annotations

import asyncio
import logging
import uuid

from halo.bus.bus import Bus
from halo.correlator.correlator import ECHO_WINDOW_MS, Correlator

MID = "22222222-2222-4222-8222-222222222222"
MID2 = "33333333-3333-4333-8333-333333333333"


def fresh_id() -> str:
    return str(uuid.uuid4())


def env(type_: str, data: dict, meetingid: str = MID) -> dict:
    return {
        "specversion": "1.0",
        "id": fresh_id(),
        "type": type_,
        "source": "halo/test",
        "time": "2026-10-31T09:00:00Z",
        "meetingid": meetingid,
        "datacontenttype": "application/json",
        "data": data,
    }


def started(meetingid: str = MID) -> dict:
    return env("meeting.started", {
        "meeting_id": meetingid, "platform": "meet", "meeting_code": "abc-defg-hij",
        "t0_ms": 1760000000000, "self_name": "Karim",
    }, meetingid)


def ended(meetingid: str = MID) -> dict:
    return env("meeting.ended", {"reason": "left"}, meetingid)


def snapshot(*tiles: tuple[str, str, bool]) -> dict:
    return env("tiles.snapshot", {
        "tiles": [
            {"tile_id": tid, "name": name, "is_self": is_self, "rect": [0, 0, 400, 225],
             "video_w": 640, "video_h": 360, "fit": "cover", "captions_rect": None}
            for tid, name, is_self in tiles
        ]
    })


def active(tile_id: str, speaking: bool, ts: int) -> dict:
    return env("speaker.active", {"tile_id": tile_id, "speaking": speaking, "ts_ms": ts})


def final(turn_id: str, stream: str, speaker: str, text: str, start: int, end: int) -> dict:
    return env("transcript.final", {
        "turn_id": turn_id, "stream": stream, "speaker": speaker, "text": text,
        "lang": "en", "ts_start_ms": start, "ts_end_ms": end,
    })


T1 = "00000030-0000-4000-8000-000000000030"
T2 = "00000031-0000-4000-8000-000000000031"
T3 = "00000032-0000-4000-8000-000000000032"
T4 = "00000033-0000-4000-8000-000000000033"
T5 = "00000034-0000-4000-8000-000000000034"


def run_scenario(events: list[dict], **kwargs) -> dict:
    settle_s = kwargs.pop("settle_s", 0.1)

    async def go() -> dict:
        bus = Bus()
        attributed: list[dict] = []
        mapped: list[dict] = []
        bus.subscribe("turn.attributed", lambda e: attributed.append(e))
        bus.subscribe("speaker.mapped", lambda e: mapped.append(e))
        Correlator(bus, **kwargs)
        for event in events:
            await bus.publish(event)
            await asyncio.sleep(0)
        await asyncio.sleep(settle_s)
        return {"attributed": attributed, "mapped": mapped}

    return asyncio.run(go())


def by_turn(attributed: list[dict]) -> dict[str, dict]:
    return {e["data"]["turn_id"]: e["data"] for e in attributed}


def test_lit_tile_provisional_within_lag():
    out = run_scenario([
        started(),
        snapshot(("tile-1", "Karim", True), ("tile-2", "Layla", False)),
        active("tile-2", True, 900),
        final(T1, "tab", "A", "Hello there.", 1000, 1500),
    ])
    turn = by_turn(out["attributed"])[T1]
    assert (turn["tile_id"], turn["name"]) == ("tile-2", "Layla")
    assert turn["attribution"] == "provisional"
    assert turn["overlap"] is False


def test_three_agreeing_turns_lock():
    events = [
        started(),
        snapshot(("tile-1", "Karim", True), ("tile-2", "Layla", False)),
        active("tile-2", True, 900),
        final(T1, "tab", "A", "One.", 1000, 1200),
        final(T2, "tab", "A", "Two.", 2000, 2200),
        final(T3, "tab", "A", "Three.", 3000, 3200),
    ]
    out = run_scenario(events)
    assert len(out["mapped"]) == 1
    mapping = out["mapped"][0]["data"]
    assert mapping["speaker"] == "A"
    assert mapping["tile_id"] == "tile-2"
    assert mapping["locked"] is True
    assert mapping.get("corrects", []) == []
    assert by_turn(out["attributed"])[T3]["attribution"] == "locked"


def test_wrong_highlight_corrects():
    events = [
        started(),
        snapshot(("tile-1", "Karim", True), ("tile-2", "Layla", False), ("tile-3", "Omar", False)),
        active("tile-3", True, 900),
        final(T1, "tab", "A", "One.", 1000, 1200),
        final(T2, "tab", "A", "Two.", 2000, 2200),
        active("tile-3", False, 2400),
        active("tile-2", True, 2500),
        final(T3, "tab", "A", "Three.", 3000, 3200),
        final(T4, "tab", "A", "Four.", 4000, 4200),
        final(T5, "tab", "A", "Five.", 5000, 5200),
    ]
    out = run_scenario(events)
    assert by_turn(out["attributed"])[T1]["tile_id"] == "tile-3"
    assert len(out["mapped"]) == 1
    mapping = out["mapped"][0]["data"]
    assert mapping["tile_id"] == "tile-2"
    assert mapping["locked"] is True
    assert sorted(mapping["corrects"]) == sorted([T1, T2])


def test_two_tiles_lit_overlap():
    out = run_scenario([
        started(),
        snapshot(("tile-1", "Karim", True), ("tile-2", "Layla", False)),
        active("tile-1", True, 900),
        active("tile-2", True, 950),
        final(T1, "tab", "A", "Crosstalk.", 1000, 1500),
    ])
    turn = by_turn(out["attributed"])[T1]
    assert turn["overlap"] is True
    assert turn["attribution"] == "provisional"


def test_echo_drop_and_keep():
    out = run_scenario([
        started(),
        snapshot(("tile-1", "Karim", True), ("tile-2", "Layla", False)),
        final(T1, "tab", "A", "Hello there.", 1000, 1500),
        final(T2, "mic", "you", "Hello there.", 1000 + ECHO_WINDOW_MS - 500, 2000),
        final(T3, "mic", "you", "Hello there.", 1000 + ECHO_WINDOW_MS + 1500, 5000),
    ])
    turns = by_turn(out["attributed"])
    assert T1 in turns
    assert T2 not in turns
    assert turns[T3]["tile_id"] == "tile-1"
    assert turns[T3]["attribution"] == "locked"


def test_mic_you_locks_self_without_highlight():
    out = run_scenario([
        started(),
        snapshot(("tile-1", "Karim", True), ("tile-2", "Layla", False)),
        final(T1, "mic", "you", "My note.", 1000, 1500),
    ])
    turn = by_turn(out["attributed"])[T1]
    assert (turn["tile_id"], turn["name"]) == ("tile-1", "Karim")
    assert turn["attribution"] == "locked"


def test_held_until_first_snapshot():
    out = run_scenario([
        started(),
        final(T1, "tab", "A", "Early words.", 1000, 1500),
        active("tile-2", True, 900),
        snapshot(("tile-1", "Karim", True), ("tile-2", "Layla", False)),
    ])
    turn = by_turn(out["attributed"])[T1]
    assert turn["tile_id"] == "tile-2"
    assert turn["attribution"] == "provisional"


def test_no_snapshot_timeout_drops_with_warning(caplog):

    with caplog.at_level(logging.WARNING, logger="halo.correlator"):
        out = run_scenario(
            [started(), final(T1, "tab", "A", "Lost words.", 1000, 1500)],
            hold_timeout_s=0.2,
            settle_s=0.5,
        )
    assert T1 not in by_turn(out["attributed"])
    assert any("dropping held turn" in r.message for r in caplog.records)


def test_unlit_tiles_best_available():
    out = run_scenario([
        started(),
        snapshot(("tile-1", "Karim", True), ("tile-2", "Layla", False)),
        final(T1, "tab", "A", "Quiet room.", 1000, 1500),
    ])
    turn = by_turn(out["attributed"])[T1]
    assert turn["tile_id"] in ("tile-1", "tile-2")
    assert turn["attribution"] == "provisional"


def test_ended_clears_locks():
    out = run_scenario([
        started(MID),
        snapshot(("tile-1", "Karim", True), ("tile-2", "Layla", False)),
        active("tile-2", True, 900),
        final(T1, "tab", "A", "One.", 1000, 1200),
        final(T2, "tab", "A", "Two.", 2000, 2200),
        final(T3, "tab", "A", "Three.", 3000, 3200),
        ended(MID),
        started(MID2),
        snapshot(("tile-1", "Karim", True), ("tile-2", "Layla", False)),
        active("tile-2", True, 900),
        final(T4, "tab", "A", "New meeting.", 1000, 1200),
    ])
    assert len(out["mapped"]) == 1, "no new lock in the second meeting after one turn"
    assert by_turn(out["attributed"])[T4]["attribution"] == "provisional"


def test_replayed_started_keeps_locks():
    """Issue #57: a repeated meeting.started for the current meeting (the
    Gateway's post-restart replay) must not wipe tiles or locks."""
    same = started(MID)
    out = run_scenario([
        same,
        snapshot(("tile-1", "Karim", True), ("tile-2", "Layla", False)),
        active("tile-2", True, 900),
        final(T1, "tab", "A", "One.", 1000, 1200),
        final(T2, "tab", "A", "Two.", 2000, 2200),
        final(T3, "tab", "A", "Three.", 3000, 3200),
        same,
        final(T4, "tab", "A", "Four.", 4000, 4200),
    ])
    turn = by_turn(out["attributed"])[T4]
    assert (turn["tile_id"], turn["attribution"]) == ("tile-2", "locked")
