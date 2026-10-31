"""Notes service tests: every PLAN case against a seeded store file.

The seed helper mirrors the two base tables read here (`meetings`,
`events`) from `backend/halo/event_store/store.py` (source of truth; only
columns selected). HTTP runs through `TestClient` with the service pointed
at tmp dirs, so the repo is never touched.
"""

from __future__ import annotations

import json
import sqlite3
import uuid

from fastapi import FastAPI
from fastapi.testclient import TestClient
from halo.bus import Bus
from halo.notes_service import NotesService

from contracts.gen.pydantic.models import MeetingPage
from contracts.validate import validate_envelope

MEETING = "22222222-2222-4222-8222-222222222222"
T0 = 1760000000000
T1 = "00000030-0000-4000-8000-000000000030"
T2 = "00000031-0000-4000-8000-000000000031"
P1 = "00000040-0000-4000-8000-000000000040"

MINI_DDL = """
CREATE TABLE meetings (meeting_id TEXT PRIMARY KEY, platform TEXT,
meeting_code TEXT, t0_ms INTEGER, self_name TEXT, subject TEXT,
project_id TEXT, ended_at TEXT, reason TEXT);
CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT,
id TEXT UNIQUE NOT NULL, type TEXT NOT NULL, time TEXT NOT NULL,
meetingid TEXT, source TEXT NOT NULL, datacontenttype TEXT, data TEXT NOT NULL);
"""

def assert_valid_page(page):
    """The served page validates against the #14 codegen model."""
    MeetingPage.model_validate(page)


def seed_db(path, *, ended=True, ready=True, user_tag=False):
    conn = sqlite3.connect(str(path))
    conn.executescript(MINI_DDL)
    conn.execute(
        "INSERT INTO meetings (meeting_id, platform, meeting_code, t0_ms,"
        " self_name, subject, project_id, ended_at, reason)"
        " VALUES (?, 'meet', 'abc-defg-hij', ?, 'Karim', 'Launch readiness',"
        " 'halo-q4', ?, ?)",
        (MEETING, T0, "2026-10-31T09:30:00Z" if ended else None,
         "left" if ended else None))
    for i, (tid, speaker, text) in enumerate(
            [(T1, "Layla", "Launch moves to Nov 12."), (T2, "Omar", "Noted, thanks.")]):
        conn.execute(
            "INSERT INTO events (id, type, time, meetingid, source, datacontenttype, data)"
            " VALUES (?, 'turn.attributed', ?, ?, 'halo/test', 'application/json', ?)",
            (tid, "2026-10-31T09:00:00Z", MEETING, json.dumps({
                "turn_id": tid, "text": text, "lang": "en",
                "ts_start_ms": T0 + 1000 + i * 3000, "ts_end_ms": T0 + 4000 + i * 3000,
                "tile_id": f"t{i + 1}", "name": speaker,
                "attribution": "locked", "overlap": False})))
    conn.execute(
        "INSERT INTO events (id, type, time, meetingid, source, datacontenttype, data)"
        " VALUES (?, 'points.upsert', ?, ?, 'halo/test', 'application/json', ?)",
        (P1, "2026-10-31T09:00:00Z", MEETING, json.dumps({
            "point_id": P1, "tile_id": "t1", "speaker_name": "Layla",
            "kind": "decision", "text": "Launch moves to Nov 12", "lang": "en",
            "quote": "Launch moves to Nov 12.", "turn_ids": [T1], "rank": 1,
            "attribution": "locked", "urgency": "medium", "is_action": True,
            "engine": "spark-open"})))
    conn.execute(
        "INSERT INTO events (id, type, time, meetingid, source, datacontenttype, data)"
        " VALUES (?, 'meeting.context', ?, ?, 'halo/test', 'application/json', ?)",
        (str(uuid.uuid4()), "2026-10-31T09:00:00Z", MEETING, json.dumps({
            "subject": "Launch readiness", "agenda": ["dates"],
            "roles": [{"name": "Layla", "role": "Engineering lead"}],
            "viewer_lang": "en"})))
    if user_tag:
        conn.execute(
            "INSERT INTO events (id, type, time, meetingid, source, datacontenttype, data)"
            " VALUES (?, 'tags.set', ?, ?, 'halo/test', 'application/json', ?)",
            (str(uuid.uuid4()), "2026-10-31T09:00:00Z", MEETING, json.dumps({
                "target": "point", "target_id": P1, "urgency": "urgent",
                "source": "user"})))
    if ready:
        from halo.notes_service.notes_service import action_id_for

        conn.execute(
            "INSERT INTO events (id, type, time, meetingid, source, datacontenttype, data)"
            " VALUES (?, 'notes.ready', ?, ?, 'halo/notes_builder', 'application/json', ?)",
            (str(uuid.uuid4()), "2026-10-31T09:00:00Z", MEETING, json.dumps({
                "meeting_id": MEETING, "project_id": "halo-q4",
                "url": f"/notes/{MEETING}", "degraded": False, "people": [{
                    "name": "Layla", "role": "Engineering lead", "why": "Owns RTL.",
                    "relevant_points": [], "own_points": [P1], "actions": [{
                        "action_id": action_id_for(P1), "text": "Launch moves to Nov 12",
                        "owner": "Layla", "status": "assigned", "urgency": "medium"}]}]})))
    conn.commit()
    conn.close()


def make_client(tmp_path, **seed_kwargs):
    from halo.notes_service.notes_service import router

    data = tmp_path / "data"
    data.mkdir(parents=True)
    static = tmp_path / "notes-page"
    static.mkdir(parents=True)
    (static / "index.html").write_text("<html>shell</html>", encoding="utf-8")
    (static / "app.js").write_text("// app", encoding="utf-8")
    (static / "styles.css").write_text("/* css */", encoding="utf-8")
    seed_db(data / "events.sqlite", **seed_kwargs)
    bus = Bus()
    app = FastAPI()
    app.state.notes_service = NotesService(bus, data_dir=data, static_dir=static)
    app.include_router(router)
    client = TestClient(app, headers={"host": "127.0.0.1:8765"})
    return client, bus, data


def test_shell_and_static(tmp_path):
    client, _, _ = make_client(tmp_path)
    shell = client.get(f"/notes/{MEETING}")
    assert shell.status_code == 200 and "shell" in shell.text
    assert client.get("/notes/unknown-id").status_code == 404
    assert client.get("/notes/app.js").status_code == 200
    assert client.get("/notes/styles.css").status_code == 200


def test_page_json_matches_schema(tmp_path):
    client, _, _ = make_client(tmp_path)
    res = client.get(f"/api/meetings/{MEETING}")
    assert res.status_code == 200
    page = res.json()
    assert_valid_page(page)
    assert page["meeting"]["subject"] == "Launch readiness"
    assert page["meeting"]["degraded"] is False
    assert page["recording"] == {"path": f"recordings/{MEETING}.webm", "start_ts_ms": T0}
    assert client.get("/api/meetings/unknown-id").status_code == 404


def test_live_fallback_before_builder(tmp_path):
    client, _, _ = make_client(tmp_path, ready=False)
    page = client.get(f"/api/meetings/{MEETING}").json()
    assert page["meeting"]["degraded"] is True
    assert len(page["actions"]) == 1 and page["actions"][0]["status"] == "suggested"
    assert page["actions"][0]["point_id"] == P1


def test_list_and_project_filter(tmp_path):
    client, _, _ = make_client(tmp_path)
    meetings = client.get("/api/meetings").json()
    assert meetings == [{"meeting_id": MEETING, "subject": "Launch readiness",
                         "people": ["Layla", "Omar"], "date": "Thu 09 Oct"}]
    assert client.get("/api/meetings", params={"project_id": "halo-q4"}).json() == meetings
    assert client.get("/api/meetings", params={"project_id": "other"}).json() == []


def test_search_all_scopes(tmp_path):
    client, _, _ = make_client(tmp_path)
    hits = client.get("/api/search", params={"q": "launch"}).json()["hits"]
    scopes = {h["scope"] for h in hits}
    assert {"transcript", "point", "action"} <= scopes
    point = next(h for h in hits if h["scope"] == "point")
    assert point["line"] == T1 and point["speaker"] == "Layla"
    assert point["kind"] == "decision" and "Launch" in point["snippet"]
    assert client.get("/api/search").status_code == 400
    assert client.get("/api/search", params={"q": "   "}).json() == {"hits": []}
    assert client.get("/api/search", params={"q": "zzz-no-match"}).json() == {"hits": []}


def test_tags_post_publishes_user_tag(tmp_path):
    client, bus, _ = make_client(tmp_path)
    seen: list = []
    bus.subscribe("tags.set", seen.append)
    res = client.post("/api/tags", json={"target": "point", "target_id": P1,
                                         "urgency": "urgent"})
    assert res.status_code == 201
    assert validate_envelope(res.json()) == []
    assert res.json()["data"]["source"] == "user"
    assert len(seen) == 1 and seen[0]["data"]["urgency"] == "urgent"
    action = client.post("/api/tags", json={"target": "action", "target_id": P1,
                                            "urgency": "later"})
    assert action.status_code == 201
    assert client.post("/api/tags", json={"target": "point", "target_id": P1}).status_code == 422
    assert client.post("/api/tags", json={"target": "point", "target_id": P1,
                                          "kind": "nope"}).status_code == 422
    assert client.post("/api/tags", json={"target": "point",
                                          "target_id": "00000099-0000-4000-8000-000000000099",
                                          "kind": "point"}).status_code == 404


def test_audio_states(tmp_path):
    live, _, _ = make_client(tmp_path / "live", ended=False)
    assert live.get("/api/audio", params={"meeting_id": MEETING}).status_code == 429
    client, _, data = make_client(tmp_path / "done")
    assert client.get("/api/audio", params={"meeting_id": MEETING}).status_code == 404
    rec = data / "recordings"
    rec.mkdir()
    (rec / f"{MEETING}.webm").write_bytes(b"fake-webm")
    assert client.get("/api/audio", params={"meeting_id": MEETING}).status_code == 200
    assert client.get("/api/audio", params={"meeting_id": MEETING,
                                            "turn_id": T1}).status_code == 501
    assert client.get("/api/audio", params={"meeting_id": "unknown"}).status_code == 404


def test_user_tags_reach_page_and_search(tmp_path):
    client, _, _ = make_client(tmp_path, user_tag=True)
    page = client.get(f"/api/meetings/{MEETING}").json()
    assert page["points"][0]["urgency"] == "urgent"
    hits = client.get("/api/search", params={"q": "launch"}).json()["hits"]
    assert next(h for h in hits if h["scope"] == "point")["urgency"] == "urgent"
