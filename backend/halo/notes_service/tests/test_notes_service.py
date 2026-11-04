"""Notes service tests: every PLAN case against a seeded store file.

The seed helper mirrors the two base tables read here (`meetings`,
`events`) from `backend/halo/event_store/store.py` (source of truth; only
columns selected). HTTP runs through `TestClient` with the service pointed
at tmp dirs, so the repo is never touched.
"""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

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


def seed_db(path, *, ended=True, ready=True, user_tag=False, summary=False):
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
                "url": f"/notes/{MEETING}", "degraded": False,
                **({"title": "Launch date moves to Nov 12", "meeting_type": "planning",
                    "summary": "The launch moves to Nov 12. Layla owns it.",
                    "disagreements": [{"topic": "Launch date", "outcome": "settled",
                                       "sides": [{"name": "Layla", "view": "Nov 12."}]}]}
                   if summary else {}),
                "people": [{
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
    gone = client.get("/notes/unknown-id", follow_redirects=False)  # a deleted meeting's bookmark
    assert gone.status_code == 307 and gone.headers["location"] == "/notes/"
    assert client.get("/notes/app.js").status_code == 200
    assert client.get("/notes/styles.css").status_code == 200
    for url in (f"/notes/{MEETING}", "/notes/app.js", "/notes/styles.css"):
        assert client.get(url).headers["cache-control"] == "no-cache"  # updates show at once


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
                         "people": ["Layla", "Omar"], "date": "Thu 09 Oct", "folder_id": None,
                         "t0_ms": T0, "minutes": 0,  # card facts (locked design)
                         "archived": False, "meeting_type": None, "self_name": "Karim",
                         "counts": {"decision": 1, "question": 0, "pushback": 0, "urgent": 0}}]
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


def test_ai_title_and_summary_from_notes_ready(tmp_path):
    """Karim 2026-11-02: the builder's AI title + summary reach the page and the list."""
    client, _, _ = make_client(tmp_path, summary=True)
    page = client.get(f"/api/meetings/{MEETING}").json()
    assert_valid_page(page)
    assert page["meeting"]["title"] == "Launch date moves to Nov 12"
    assert page["meeting"]["summary"] == "The launch moves to Nov 12. Layla owns it."
    assert page["meeting"]["disagreements"][0]["topic"] == "Launch date"
    assert client.get("/api/meetings").json()[0]["title"] == "Launch date moves to Nov 12"


def test_list_shell_address(tmp_path):
    """/notes/ is the list's own address, so browser Back lands on it (#102)."""
    client, _, _ = make_client(tmp_path)
    assert client.get("/notes/").status_code == 200
    assert "shell" in client.get("/notes").text
    # 2026-11-03: /notes served the shell, whose ./app.js then 404'd; it redirects now.
    bare = client.get("/notes", follow_redirects=False)
    assert bare.status_code == 307 and bare.headers["location"] == "/notes/"


def test_folders_create_move_and_persist(tmp_path):
    client, bus, data = make_client(tmp_path)
    assert client.get("/api/folders").json() == []
    res = client.post("/api/folders", json={"name": "Launch", "meeting_id": MEETING})
    assert res.status_code == 201
    folder = res.json()
    assert folder["name"] == "Launch"
    assert client.get("/api/folders").json() == [{**folder, "count": 1}]
    assert client.get("/api/meetings").json()[0]["folder_id"] == folder["folder_id"]
    assert client.post("/api/folders/move", json={"meeting_id": MEETING, "folder_id": None}).status_code == 200
    assert client.get("/api/meetings").json()[0]["folder_id"] is None
    assert client.post("/api/folders", json={"name": "  "}).status_code == 400
    assert client.post("/api/folders/move", json={"meeting_id": MEETING, "folder_id": "nope"}).status_code == 404
    # A fresh service (backend restart) reads the same folders back.
    from halo.notes_service.notes_service import NotesService
    again = NotesService(bus, data_dir=data)
    assert [f["name"] for f in again.folders()] == ["Launch"]


def test_writes_refuse_other_sites(tmp_path):
    """Another site open in Chrome cannot POST to the notes API."""
    client, _, _ = make_client(tmp_path)
    evil = {"origin": "https://evil.example"}
    assert client.post("/api/folders", json={"name": "x"}, headers=evil).status_code == 403
    assert client.post("/api/folders/move", json={"meeting_id": MEETING, "folder_id": None},
                       headers=evil).status_code == 403
    assert client.post("/api/tags", json={"target": "point", "target_id": P1, "urgency": "urgent"},
                       headers=evil).status_code == 403
    own = {"origin": "http://127.0.0.1:8765"}
    assert client.post("/api/folders", json={"name": "x"}, headers=own).status_code == 201


def test_the_latest_model_tag_wins_but_never_over_a_user_tag(tmp_path):
    """DECISIONS: latest user tag > latest model tag > guess. Live 2026-11-02:
    the page kept the first model tag, so a corrected kind never showed."""
    client, _, data = make_client(tmp_path, user_tag=True)  # user set urgency=urgent
    conn = sqlite3.connect(data / "events.sqlite")
    for kind, urgency in (("pushback", "later"), ("point", "medium")):  # model, in order
        conn.execute(
            "INSERT INTO events (id, type, time, meetingid, source, datacontenttype, data)"
            " VALUES (?, 'tags.set', ?, ?, 'halo/classifier', 'application/json', ?)",
            (str(uuid.uuid4()), "2026-10-31T09:01:00Z", MEETING, json.dumps({
                "target": "point", "target_id": P1, "kind": kind, "urgency": urgency,
                "source": "model", "model": "x"})))
    conn.commit()
    conn.close()
    point = client.get(f"/api/meetings/{MEETING}").json()["points"][0]
    assert point["kind"] == "point"  # the latest model tag
    assert point["urgency"] == "urgent"  # the user's tag still wins


def test_the_service_owner_rule_matches_the_builder():
    from halo.notes_service.notes_service import owner_for
    assert owner_for("Omar sends it.", "", ["", "Omar"]) == "Omar"
    assert owner_for("Ali sends it.", "Omar", ["Ali Hassan", "Ali Khan", "Omar"]) == "Omar"


def test_folders_rename_and_delete_keep_the_meetings(tmp_path):
    """Karim 2026-11-04: a folder can be renamed or deleted; its meetings stay, just unfiled."""
    client, _, _ = make_client(tmp_path)
    folder = client.post("/api/folders", json={"name": "Halo", "meeting_id": MEETING}).json()
    fid = folder["folder_id"]
    assert client.post("/api/folders/rename", json={"folder_id": fid, "name": " Launch "}).status_code == 200
    assert client.get("/api/folders").json() == [{"folder_id": fid, "name": "Launch", "count": 1}]
    assert client.post("/api/folders/rename", json={"folder_id": fid, "name": " "}).status_code == 400
    assert client.post("/api/folders/rename", json={"folder_id": "nope", "name": "x"}).status_code == 404
    assert client.post("/api/folders/delete", json={"folder_id": fid}).status_code == 200
    assert client.get("/api/folders").json() == []
    listed = client.get("/api/meetings").json()
    assert len(listed) == 1 and listed[0]["folder_id"] is None
    assert client.post("/api/folders/delete", json={"folder_id": fid}).status_code == 404


def test_archive_a_meeting_and_bring_it_back(tmp_path):
    client, _, data = make_client(tmp_path)
    assert client.get("/api/meetings").json()[0]["archived"] is False
    assert client.post("/api/meetings/archive", json={"meeting_id": MEETING, "archived": True}).status_code == 200
    assert client.get("/api/meetings").json()[0]["archived"] is True
    from halo.notes_service.notes_service import NotesService
    assert NotesService(Bus(), data_dir=data).list_meetings()[0]["archived"] is True  # survives a restart
    assert client.post("/api/meetings/archive", json={"meeting_id": MEETING, "archived": False}).status_code == 200
    assert client.get("/api/meetings").json()[0]["archived"] is False
    assert client.post("/api/meetings/archive", json={"meeting_id": MEETING}).status_code == 400


def test_meeting_type_from_the_builder_and_set_by_hand(tmp_path):
    """Karim 2026-11-04: Halo sorts each meeting by type; the user can change it."""
    client, _, _ = make_client(tmp_path, summary=True)
    item = client.get("/api/meetings").json()[0]
    assert (item["meeting_type"], item["type_by"]) == ("planning", "halo")
    assert client.post("/api/meetings/type", json={"meeting_id": MEETING, "meeting_type": "sales"}).status_code == 200
    item = client.get("/api/meetings").json()[0]
    assert (item["meeting_type"], item["type_by"]) == ("sales", "you")
    assert client.post("/api/meetings/type", json={"meeting_id": MEETING, "meeting_type": "party"}).status_code == 400
    # null hands it back to Halo's pick.
    assert client.post("/api/meetings/type", json={"meeting_id": MEETING, "meeting_type": None}).status_code == 200
    assert client.get("/api/meetings").json()[0]["type_by"] == "halo"


def test_meeting_without_a_type_has_none(tmp_path):
    client, _, _ = make_client(tmp_path)
    item = client.get("/api/meetings").json()[0]
    assert item["meeting_type"] is None and "type_by" not in item


def test_new_writes_refuse_other_sites(tmp_path):
    client, _, _ = make_client(tmp_path)
    evil = {"origin": "https://evil.example"}
    for path, body in [("/api/folders/rename", {"folder_id": "x", "name": "y"}),
                       ("/api/folders/delete", {"folder_id": "x"}),
                       ("/api/meetings/archive", {"meeting_id": MEETING, "archived": True}),
                       ("/api/meetings/type", {"meeting_id": MEETING, "meeting_type": "sales"})]:
        assert client.post(path, json=body, headers=evil).status_code == 403, path


def test_page_lists_fact_checks_newest_per_point(tmp_path):
    db = tmp_path / "events.sqlite"
    seed_db(db)
    conn = sqlite3.connect(db)
    for n, note in enumerate(("Old note.", "New note.")):
        conn.execute(
            "INSERT INTO events (id, type, time, meetingid, source, datacontenttype, data)"
            " VALUES (?, 'claim.checked', '2026-10-31T09:00:00Z', ?, 'halo/fact_check', 'application/json', ?)",
            (f"fc-{n}", MEETING, json.dumps({
                "point_id": "00000021-0000-4000-8000-000000000021", "claim": "Qatar has 10 million people.",
                "speaker_name": "Omar", "verdict": "disputed", "note": note,
                "sources": ["https://a.example/1"], "lang": "en"})))
    conn.commit()
    conn.close()
    page = NotesService(Bus(), data_dir=tmp_path).page_for(MEETING)
    assert_valid_page(page)
    assert [c["note"] for c in page["fact_checks"]] == ["New note."]


def test_page_without_fact_checks_has_no_key(tmp_path):
    db = tmp_path / "events.sqlite"
    seed_db(db)
    assert "fact_checks" not in NotesService(Bus(), data_dir=tmp_path).page_for(MEETING)


class ImageLLM:
    def __init__(self, image=b"png-bytes"):
        self.image = image
        self.prompts = []

    def generate_image(self, prompt):
        self.prompts.append(prompt)
        return self.image


def recap_client(tmp_path, llm):
    client, _, data = make_client(tmp_path)
    client.app.state.notes_service._llm = llm
    return client, data


def test_recap_is_made_once_on_request_and_then_served_from_disk(tmp_path):
    llm = ImageLLM()
    client, _ = recap_client(tmp_path, llm)
    url = f"/api/meetings/{MEETING}/recap"
    assert client.get(url).status_code == 404  # nothing is spent until someone asks
    assert llm.prompts == [] and client.get(f"/api/meetings/{MEETING}").json().get("visual_recap") is not True
    assert client.post(url).status_code == 200
    assert client.post(url).status_code == 200  # the second press costs nothing
    assert len(llm.prompts) == 1
    shown = client.get(url)
    assert shown.status_code == 200 and shown.content == b"png-bytes"
    assert shown.headers["content-type"] == "image/png"
    assert client.get(f"/api/meetings/{MEETING}").json()["visual_recap"] is True


def test_recap_refuses_foreign_origins_unknown_meetings_and_reports_failure(tmp_path):
    llm = ImageLLM(image=None)
    client, _ = recap_client(tmp_path, llm)
    url = f"/api/meetings/{MEETING}/recap"
    assert client.post(url, headers={"origin": "https://evil.example"}).status_code == 403
    assert llm.prompts == []
    assert client.post("/api/meetings/unknown-id/recap").status_code == 404
    assert client.post(url).status_code == 502


def test_two_presses_at_once_draw_one_image(tmp_path):
    class SlowLLM(ImageLLM):
        def generate_image(self, prompt):
            time.sleep(0.1)
            return super().generate_image(prompt)

    llm = SlowLLM()
    client, _ = recap_client(tmp_path, llm)
    service = client.app.state.notes_service
    with ThreadPoolExecutor(2) as pool:
        paths = list(pool.map(service.make_recap, [MEETING, MEETING]))
    assert all(paths) and len(llm.prompts) == 1


def test_a_meeting_still_running_is_marked_and_draws_no_recap(tmp_path):
    llm = ImageLLM()
    client, _, = recap_client_open(tmp_path, llm)
    assert client.get(f"/api/meetings/{MEETING}").json()["meeting"]["in_progress"] is True
    assert client.post(f"/api/meetings/{MEETING}/recap").status_code == 409
    assert llm.prompts == []


def recap_client_open(tmp_path, llm):
    client, _, data = make_client(tmp_path, ended=False, ready=False)
    client.app.state.notes_service._llm = llm
    return client, data
