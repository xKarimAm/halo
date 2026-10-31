"""Issue #57: on pair.ok the Gateway republishes the latest open meeting's
stored meeting.started (+ latest context) so a restarted backend resumes."""

from __future__ import annotations

import asyncio
import json
import sqlite3
from pathlib import Path

from halo.bus import Bus
from halo.gateway.gateway import Gateway
from halo.gateway.tests.test_session import paired

OPEN = "22222222-2222-4222-8222-222222222222"
DONE = "33333333-3333-4333-8333-333333333333"


def seed(data_dir: Path, rows: list[tuple[str, str, str, dict]]) -> None:
    # The Event Store's events columns, without importing that lane.
    db = sqlite3.connect(data_dir / "events.sqlite")
    db.execute("CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE,"
               " type TEXT, time TEXT, meetingid TEXT, source TEXT, data TEXT)")
    for id_, type_, mid, data in rows:
        db.execute("INSERT INTO events (id, type, time, meetingid, source, data)"
                   " VALUES (?, ?, '2026-10-31T09:00:00Z', ?, 'halo/test', ?)",
                   (id_, type_, mid, json.dumps(data)))
    db.commit()
    db.close()


def started(mid: str) -> dict:
    return {"meeting_id": mid, "platform": "meet", "meeting_code": "abc-defg-hij",
            "t0_ms": 1760000000000, "self_name": "Karim"}


CONTEXT = {"subject": "Launch", "agenda": [], "roles": [], "viewer_lang": "en"}


def test_pair_ok_replays_open_meeting_once(tmp_path):
    seed(tmp_path, [
        ("00000011-0000-4000-8000-000000000011", "meeting.started", DONE, started(DONE)),
        ("00000012-0000-4000-8000-000000000012", "meeting.ended", DONE, {"reason": "left"}),
        ("00000013-0000-4000-8000-000000000013", "meeting.started", OPEN, started(OPEN)),
        ("00000014-0000-4000-8000-000000000014", "meeting.context", OPEN, {**CONTEXT, "subject": "old"}),
        ("00000015-0000-4000-8000-000000000015", "meeting.context", OPEN, CONTEXT),
    ])

    async def run() -> list[dict]:
        gateway = Gateway(Bus(), data_dir=tmp_path, extension_id="test-id")
        seen: list[dict] = []
        gateway.bus.subscribe("meeting.started", seen.append)
        gateway.bus.subscribe("meeting.context", seen.append)
        await paired(gateway)
        await paired(gateway)  # a socket blip: no second replay
        return seen

    seen = asyncio.run(run())
    assert [(e["id"], e["type"], e["meetingid"]) for e in seen] == [
        ("00000013-0000-4000-8000-000000000013", "meeting.started", OPEN),
        ("00000015-0000-4000-8000-000000000015", "meeting.context", OPEN),
    ]
    assert seen[1]["data"] == CONTEXT


def test_pair_ok_skips_meeting_already_seen_from_hub(tmp_path):
    seed(tmp_path, [
        ("00000013-0000-4000-8000-000000000013", "meeting.started", OPEN, started(OPEN)),
    ])

    async def run() -> list[dict]:
        gateway = Gateway(Bus(), data_dir=tmp_path, extension_id="test-id")
        gateway.deduped("00000013-0000-4000-8000-000000000013")  # the hub sent it here
        seen: list[dict] = []
        gateway.bus.subscribe("meeting.started", seen.append)
        await paired(gateway)
        return seen

    assert asyncio.run(run()) == []


def test_pair_ok_without_store_replays_nothing(tmp_path):
    async def run() -> list[dict]:
        gateway = Gateway(Bus(), data_dir=tmp_path, extension_id="test-id")
        seen: list[dict] = []
        gateway.bus.subscribe("meeting.started", seen.append)
        await paired(gateway)
        return seen

    assert asyncio.run(run()) == []
