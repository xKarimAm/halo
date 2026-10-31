"""Notes builder tests: every PLAN case against a scripted model fake and a
seeded SQLite file.

The seed helper creates only the two base tables this lane reads
(`meetings`, `events`) with DDL mirrored from `backend/halo/event_store/
store.py` (the source of truth; only columns the builder selects). Turns,
points, tags and contexts all live in `events` as JSON there.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import threading
import uuid
from types import SimpleNamespace

from halo.bus import Bus
from halo.notes_builder import NotesBuilder

from contracts.validate import validate_envelope

MEETING = "22222222-2222-4222-8222-222222222222"
T0 = 1760000000000
T1 = "00000030-0000-4000-8000-000000000030"
T2 = "00000031-0000-4000-8000-000000000031"
P1 = "00000040-0000-4000-8000-000000000040"

# Minimal mirror of the EventStore DDL for the two base tables read here.
MINI_DDL = """
CREATE TABLE meetings (meeting_id TEXT PRIMARY KEY, platform TEXT,
meeting_code TEXT, t0_ms INTEGER, self_name TEXT, subject TEXT,
project_id TEXT, ended_at TEXT, reason TEXT);
CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT,
id TEXT UNIQUE NOT NULL, type TEXT NOT NULL, time TEXT NOT NULL,
meetingid TEXT, source TEXT NOT NULL, datacontenttype TEXT, data TEXT NOT NULL);
"""


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


def repair_draft(prompt: str) -> dict:
    """A model stub that repairs quotes from the provided transcript."""
    draft = json.loads(prompt.split("Current draft page: ", 1)[1].split("\nViolations", 1)[0])
    transcript = json.loads(prompt.split("Transcript: ", 1)[1].split("\nCandidate", 1)[0])
    texts = [t["text"] for t in transcript]
    for point in draft["points"]:
        if not any(point["quote"] in text for text in texts):
            point["quote"] = texts[0] if texts else ""
    return draft


class FakeLLM:
    def __init__(self, clock: Clock, replies: list) -> None:
        self._clock = clock
        self._replies = list(replies)
        self.calls: list[str] = []

    def complete_json(self, *, prompt, schema, schema_name="notes.page",
                      system=None, prompt_cache_key=None):
        self.calls.append(prompt)
        reply = self._replies.pop(0) if self._replies else "repair"
        self._clock.advance(0.05)
        if reply == "repair":
            return SimpleNamespace(ok=True, engine="muse-spark-1.3-contributor",
                                   data=repair_draft(prompt), error=None)
        if reply.get("fail"):
            return SimpleNamespace(ok=False, engine="spark-open", data=None,
                                   error={"code": "engine_error", "message": "down"})
        return SimpleNamespace(ok=True, engine=reply.get("engine", "spark-open"),
                               data=reply["page"], error=None)

    def health(self):
        return {"engine": "spark-open", "failover": False}


def seed_db(path, *, quote="Launch moves to Nov 12.", turns=2, context=True, turn_ids=(T1,)):
    conn = sqlite3.connect(str(path))
    conn.executescript(MINI_DDL)
    conn.execute(
        "INSERT INTO meetings (meeting_id, platform, meeting_code, t0_ms,"
        " self_name, subject, project_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (MEETING, "meet", "abc-defg-hij", T0, "Karim", "Launch readiness", "halo-q4"))
    texts = ["Launch moves to Nov 12.", "Noted, thanks."]
    names = ["Layla", "Omar"]
    for i in range(turns):
        tid = [T1, T2][i]
        conn.execute(
            "INSERT INTO events (id, type, time, meetingid, source, datacontenttype, data)"
            " VALUES (?, 'turn.attributed', ?, ?, 'halo/test', 'application/json', ?)",
            (tid, "2026-10-31T09:00:00Z", MEETING, json.dumps({
                "turn_id": tid, "text": texts[i], "lang": "en",
                "ts_start_ms": T0 + 1000 + i * 3000, "ts_end_ms": T0 + 4000 + i * 3000,
                "tile_id": f"t{i + 1}", "name": names[i],
                "attribution": "locked", "overlap": False})))
    conn.execute(
        "INSERT INTO events (id, type, time, meetingid, source, datacontenttype, data)"
        " VALUES (?, 'points.upsert', ?, ?, 'halo/test', 'application/json', ?)",
        (P1, "2026-10-31T09:00:00Z", MEETING, json.dumps({
            "point_id": P1, "tile_id": "t1", "speaker_name": "Layla",
            "kind": "decision", "text": "Launch moves to Nov 12", "lang": "en",
            "quote": quote, "turn_ids": list(turn_ids), "rank": 1, "attribution": "locked",
            "urgency": "medium", "is_action": True, "engine": "spark-open"})))
    if context:
        conn.execute(
            "INSERT INTO events (id, type, time, meetingid, source, datacontenttype, data)"
            " VALUES (?, 'meeting.context', ?, ?, 'halo/test', 'application/json', ?)",
            (str(uuid.uuid4()), "2026-10-31T09:00:00Z", MEETING, json.dumps({
                "subject": "Launch readiness", "agenda": ["dates"],
                "roles": [{"name": "Layla", "role": "Engineering lead"}],
                "viewer_lang": "en"})))
    conn.commit()
    conn.close()


async def settle(bus):
    """meeting.ended only schedules the pipeline: wait for it."""
    for fn in bus._subs.get("meeting.ended", []):
        await fn.__self__.settle()


def ended_envelope(meeting_id=MEETING):
    return {
        "specversion": "1.0", "id": str(uuid.uuid4()), "type": "meeting.ended",
        "source": "halo/test", "time": "2026-10-31T09:00:00Z",
        "meetingid": meeting_id, "datacontenttype": "application/json",
        "data": {"reason": "left"},
    }


def setup(path, replies, *, seed_kwargs=None):
    seed_db(path, **(seed_kwargs or {}))
    clock = Clock()
    bus = Bus()
    llm = FakeLLM(clock, replies)
    builder = NotesBuilder(bus, llm, db_path=path)
    ready, health = [], []
    bus.subscribe("notes.ready", ready.append)
    bus.subscribe("llm.health", health.append)
    return bus, llm, builder, ready, health


def test_valid_v1_emits_one_no_model_call(tmp_path):
    async def run():
        bus, llm, _, ready, _ = setup(tmp_path / "events.sqlite", [])
        assert (await bus.publish(ended_envelope()))["status"] == "ok"
        await settle(bus)
        assert len(ready) == 1 and llm.calls == []
        assert validate_envelope(ready[0]) == []
        data = ready[0]["data"]
        assert data["meeting_id"] == MEETING and data["url"] == f"/notes/{MEETING}"
        assert data["degraded"] is False
        layla = next(p for p in data["people"] if p["name"] == "Layla")
        assert layla["own_points"] == [P1] and len(layla["actions"]) == 1
        assert layla["actions"][0]["owner"] == "Layla" and "point_id" not in layla["actions"][0]

    asyncio.run(run())


def test_broken_quote_rebuilds_once(tmp_path):
    async def run():
        bus, llm, _, ready, health = setup(
            tmp_path / "events.sqlite", ["repair"], seed_kwargs={"quote": "Launch shifted."})
        assert (await bus.publish(ended_envelope()))["status"] == "ok"
        await settle(bus)
        assert len(llm.calls) == 1
        prompt = llm.calls[0]
        assert "Transcript: " in prompt and "Candidate points: " in prompt
        assert "Current draft page: " in prompt
        assert "Launch moves to Nov 12." in prompt
        assert len(ready) == 1 and validate_envelope(ready[0]) == []
        assert len(health) == 1 and health[0]["data"]["engine"] == "muse-spark-1.3-contributor"

    asyncio.run(run())


def test_double_fubar_emits_lkg(tmp_path):
    async def run():
        db = tmp_path / "events.sqlite"
        bus, llm, _, ready, _ = setup(db, ["repair"])
        await bus.publish(ended_envelope())
        await settle(bus)
        assert len(ready) == 1
        first_data = ready[0]["data"]

        conn = sqlite3.connect(str(db))
        conn.execute("DELETE FROM events WHERE id = ?", (T1,))
        conn.commit()
        conn.close()

        broken = {"page": {"meeting": {}, "people": [], "points": [],
                           "actions": [], "transcript_lines": [],
                           "recording": {"path": "x", "start_ts_ms": 0}}}
        llm._replies.append(broken)
        await bus.publish(ended_envelope())
        await settle(bus)
        assert len(llm.calls) == 1  # exactly one rebuild across both generations
        assert len(ready) == 2 and ready[1]["data"] == first_data

    asyncio.run(run())


def test_unknown_meeting_no_output(tmp_path):
    async def run():
        db = tmp_path / "events.sqlite"
        seed_db(db)
        clock = Clock()
        bus = Bus()
        llm = FakeLLM(clock, [])
        NotesBuilder(bus, llm, db_path=db)
        ready: list = []
        bus.subscribe("notes.ready", ready.append)
        assert (await bus.publish(ended_envelope("99999999-9999-4999-8999-999999999999")))["status"] == "ok"
        await settle(bus)
        assert ready == [] and llm.calls == []

    asyncio.run(run())


def test_total_failure_no_lkg_emits_degraded_live_notes(tmp_path):
    # Live 2026-10-31 (Egyptian chain run): one reordered quote failed V1, the
    # full-page rebuild timed out at 10 s, and with no LKG the meeting ended
    # with no notes.ready at all. PLAN: fall back to the live notes, degraded.
    async def run():
        bus, llm, _, ready, _ = setup(
            tmp_path / "events.sqlite", [{"fail": True}], seed_kwargs={"quote": "Launch shifted."})
        await bus.publish(ended_envelope())
        await settle(bus)
        assert len(llm.calls) == 1 and len(ready) == 1
        assert validate_envelope(ready[0]) == []
        data = ready[0]["data"]
        assert data["degraded"] is True
        layla = next(p for p in data["people"] if p["name"] == "Layla")
        assert layla["own_points"] == [P1] and layla["why"] == ""
        assert [(a["status"], a["urgency"]) for a in layla["actions"]] == [("suggested", "medium")]

    asyncio.run(run())


def test_duplicate_ended_single_emission(tmp_path):
    async def run():
        bus, llm, _, ready, _ = setup(tmp_path / "events.sqlite", [])
        await bus.publish(ended_envelope())
        await bus.publish(ended_envelope())
        await settle(bus)
        assert len(ready) == 1 and llm.calls == []

    asyncio.run(run())


def test_multi_turn_latency_path(tmp_path):
    async def run():
        db = tmp_path / "events.sqlite"
        seed_db(db)
        conn = sqlite3.connect(str(db))
        for i in range(2, 8):
            tid = f"0000003{i}-0000-4000-8000-00000000003{i}"
            conn.execute(
                "INSERT INTO events (id, type, time, meetingid, source, datacontenttype, data)"
                " VALUES (?, 'turn.attributed', ?, ?, 'halo/test', 'application/json', ?)",
                (tid, "2026-10-31T09:00:00Z", MEETING, json.dumps({
                    "turn_id": tid, "text": f"Follow-up point number {i}.", "lang": "en",
                    "ts_start_ms": T0 + 1000 + i * 3000, "ts_end_ms": T0 + 4000 + i * 3000,
                    "tile_id": "t1", "name": "Layla", "attribution": "locked",
                    "overlap": False})))
        conn.commit()
        conn.close()
        clock = Clock()
        bus = Bus()
        llm = FakeLLM(clock, [])
        NotesBuilder(bus, llm, db_path=db)
        ready: list = []
        bus.subscribe("notes.ready", ready.append)
        await bus.publish(ended_envelope())
        await settle(bus)
        assert len(ready) == 1 and validate_envelope(ready[0]) == []
        assert len(ready[0]["data"]["people"]) == 2

    asyncio.run(run())


def test_quote_spanning_the_points_own_turns_is_verbatim(tmp_path):
    # Live 2026-10-31: Insight coalesced 3 soft-cut turns into one call and
    # quoted across them; V1 failed and the whole page went to a rebuild.
    async def run():
        bus, llm, _, ready, _ = setup(tmp_path / "events.sqlite", [], seed_kwargs={
            "quote": "Nov 12. Noted,", "turn_ids": (T1, T2)})
        await bus.publish(ended_envelope())
        await settle(bus)
        assert llm.calls == [] and len(ready) == 1

    asyncio.run(run())


def test_meeting_ended_does_not_wait_for_the_rebuild(tmp_path):
    # Live 2026-10-31: the Gateway ACKs only after bus.publish returns, so an
    # inline rebuild held the hub's ACK (and its socket) for the model call.
    async def run():
        bus, llm, builder, ready, _ = setup(
            tmp_path / "events.sqlite", ["repair"], seed_kwargs={"quote": "Launch shifted."})
        release = threading.Event()
        slow = llm.complete_json

        def blocked(**kw):
            release.wait(5)
            return slow(**kw)

        llm.complete_json = blocked
        assert (await asyncio.wait_for(bus.publish(ended_envelope()), 1))["status"] == "ok"
        assert ready == []
        release.set()
        await builder.settle()
        assert len(llm.calls) == 1 and len(ready) == 1

    asyncio.run(run())


def test_action_ids_match_the_notes_service(tmp_path):
    # The page enriches its actions from notes.ready by action_id and
    # POST /api/tags resolves actions by it; a uuid4 here never matched.
    async def run():
        bus, _, _, ready, _ = setup(tmp_path / "events.sqlite", [])
        await bus.publish(ended_envelope())
        await settle(bus)
        layla = next(p for p in ready[0]["data"]["people"] if p["name"] == "Layla")
        assert layla["actions"][0]["action_id"] == str(
            uuid.uuid5(uuid.NAMESPACE_URL, f"halo-action:{P1}"))

    asyncio.run(run())
