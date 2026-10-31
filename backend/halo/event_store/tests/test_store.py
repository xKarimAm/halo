"""Event Store tests: golden samples in, SQLite views out.

Uses the contracts ACK kit (duplicate case) and golden envelopes; the replay
case publishes the committed synthetic fixture through a real Bus + tap.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import uuid
from pathlib import Path

from halo.bus.bus import Bus
from halo.event_store.store import EventStore

from contracts.validate import validate_envelope
from rig.replayer.fixture import load_fixture

GOLDEN = Path(__file__).parents[4] / "contracts" / "golden"
ACK_KIT = Path(__file__).parents[4] / "contracts" / "ack-kit"
FIXTURE = Path(__file__).parents[4] / "rig" / "replayer" / "fixtures" / "synthetic"
MID = "22222222-2222-4222-8222-222222222222"


def golden(name: str) -> dict:
    return json.loads((GOLDEN / f"{name}.json").read_text(encoding="utf-8"))


def fresh_id() -> str:
    return str(uuid.uuid4())


def make_store(tmp_path: Path) -> EventStore:
    return EventStore(tmp_path / "events.sqlite")


def publish_all(bus: Bus, envelopes: list[dict]) -> list[dict]:
    async def go() -> list[dict]:
        return [await bus.publish(env) for env in envelopes]

    return asyncio.run(go())


def upsert(point_id: str, text: str, kind="decision", urgency="medium", **extra: object) -> dict:
    data: dict = {
        "point_id": point_id,
        "tile_id": "spaces/x/devices/1",
        "speaker_name": "Layla",
        "kind": kind,
        "text": text,
        "lang": "en",
        "quote": text + ".",
        "turn_ids": ["00000030-0000-4000-8000-000000000030"],
        "rank": 1,
        "attribution": "locked",
        "urgency": urgency,
        "is_action": True,
        "engine": "spark-open",
    }
    data.update(extra)
    return {
        "specversion": "1.0",
        "id": fresh_id(),
        "type": "points.upsert",
        "source": "halo/test",
        "time": "2026-10-31T09:00:00Z",
        "meetingid": MID,
        "datacontenttype": "application/json",
        "data": data,
    }


def tag(target_id: str, source: str, kind=None, urgency=None) -> dict:
    data: dict = {"target": "point", "target_id": target_id, "source": source}
    if kind is not None:
        data["kind"] = kind
    if urgency is not None:
        data["urgency"] = urgency
    return {
        "specversion": "1.0",
        "id": fresh_id(),
        "type": "tags.set",
        "source": "halo/test",
        "time": "2026-10-31T09:00:00Z",
        "meetingid": MID,
        "datacontenttype": "application/json",
        "data": data,
    }


def test_ack_kit_duplicate_one_row(tmp_path):
    """ACK kit duplicate case: two deliveries, ACK ok twice, one stored row."""
    case = json.loads((ACK_KIT / "duplicate.json").read_text(encoding="utf-8"))
    assert validate_envelope(case["envelope"]) == []
    store = make_store(tmp_path)
    bus = Bus()
    bus.set_tap(store.tap)
    acks = publish_all(bus, [case["envelope"]] * case["deliveries"])
    assert [a["status"] for a in acks] == case["expected"]["acks"]
    assert store.count() == case["expected"]["stored_rows"]


def test_meetings_row_first_wins_late_context(tmp_path):
    store = make_store(tmp_path)
    started = golden("meeting.started")
    context = golden("meeting.context")
    ended = golden("meeting.ended")
    for env in (started, context, ended):
        assert store.append(env) is True
    second_ended = {**ended, "id": fresh_id()}
    assert store.append(second_ended) is True
    row = store.get_meeting(MID)
    assert row["meeting_code"] == "abc-defg-hij"
    assert row["subject"] == "Launch readiness"
    assert row["project_id"] == "halo-q4"
    assert row["ended_at"] is not None and row["reason"] == ended["data"]["reason"]
    # second meeting.ended stored as an event but does not overwrite first wins
    assert store.count() == 4
    assert store.get_meeting(MID)["reason"] == ended["data"]["reason"]


def test_fts_transcript_and_quote_supersede(tmp_path):
    store = make_store(tmp_path)
    final = golden("transcript.final")
    assert store.append(final) is True
    assert store.search_transcripts("Nov 12")
    pid = "00000040-0000-4000-8000-000000000040"
    assert store.append(upsert(pid, "Launch moves to Nov 12")) is True
    assert store.search_points("Nov 12")
    # superseding upsert hides the old version from FTS
    assert store.append(upsert(pid, "Launch moves to Dec 1")) is True
    assert not store.search_points("Nov 12")
    assert store.search_points("Dec 1")


def test_points_current_replaces(tmp_path):
    store = make_store(tmp_path)
    old_id = "00000041-0000-4000-8000-000000000041"
    new_id = "00000042-0000-4000-8000-000000000042"
    assert store.append(upsert(old_id, "Old plan")) is True
    assert store.append(upsert(new_id, "New plan", replaces=old_id)) is True
    current = {row["point_id"]: row for row in store.points_current()}
    assert new_id in current
    assert old_id not in current
    assert current[new_id]["text"] == "New plan"


def test_tags_effective_user_over_model_over_guess(tmp_path):
    store = make_store(tmp_path)
    pid = "00000040-0000-4000-8000-000000000040"
    assert store.append(upsert(pid, "Launch moves to Nov 12", kind="decision", urgency="medium")) is True
    assert store.append(tag(pid, "model", kind="point", urgency="later")) is True
    assert store.append(tag(pid, "user", urgency="urgent")) is True
    eff = {r["target_id"]: r for r in store.tags_effective() if r["target"] == "point"}
    assert eff[pid]["urgency"] == "urgent"
    assert eff[pid]["kind"] == "point"  # latest model kind stands; user only set urgency
    assert eff[pid]["source"] == "user"


def test_tags_effective_model_and_guess(tmp_path):
    store = make_store(tmp_path)
    model_pid = "00000043-0000-4000-8000-000000000043"
    guess_pid = "00000044-0000-4000-8000-000000000044"
    assert store.append(upsert(model_pid, "Model tagged", kind="decision", urgency="medium")) is True
    assert store.append(tag(model_pid, "model", urgency="urgent")) is True
    assert store.append(upsert(guess_pid, "Untagged guess", kind="question", urgency="later")) is True
    eff = {r["target_id"]: r for r in store.tags_effective() if r["target"] == "point"}
    assert eff[model_pid]["urgency"] == "urgent"
    assert eff[model_pid]["source"] == "model"
    assert eff[guess_pid]["urgency"] == "later"
    assert eff[guess_pid]["kind"] == "question"
    assert eff[guess_pid]["source"] == "guess"


def test_wal_and_readonly_reader(tmp_path):
    store = make_store(tmp_path)
    assert store.append(golden("transcript.final")) is True
    assert store.journal_mode() == "wal"
    ro = sqlite3.connect(f"file:{store.path}?mode=ro", uri=True)
    try:
        assert ro.execute("select count(*) from events").fetchone()[0] == 1
    finally:
        ro.close()


def test_fixture_replay_lands_once(tmp_path):
    fixture = load_fixture(FIXTURE)
    assert fixture.envelopes, "synthetic fixture has no envelopes"
    store = make_store(tmp_path)
    bus = Bus()
    bus.set_tap(store.tap)
    # Mode A strips the scheduling ts_ms before sending; do the same here.
    sends = [{k: v for k, v in e.items() if k != "ts_ms"} for e in fixture.envelopes]
    acks = publish_all(bus, sends)
    assert all(a["status"] == "ok" for a in acks)
    assert store.count() == len(fixture.envelopes)
    # redelivery dedupes at the UNIQUE line
    publish_all(bus, [dict(e) for e in sends])
    assert store.count() == len(fixture.envelopes)
    assert store.search_transcripts("Pricing stays")


def test_health(tmp_path):
    assert make_store(tmp_path).health_status() == "ok"
