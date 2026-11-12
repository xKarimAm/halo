"""Past-meeting notes for the fact check (design 2026-11-13-fact-check-past-meetings).

On meeting.context naming a notes-page Project, the meeting is filed there and the
Project's other meetings are written to references/<id>.past.json for Fact Check."""

from __future__ import annotations

import asyncio
import json

from halo.bus import Bus
from halo.notes_service import NotesService
from test_notes_service import MEETING, seed_db  # type: ignore[import-not-found]  # same folder under pytest

NEW = "33333333-3333-4333-8333-333333333333"


def context(project_id: str | None) -> dict:
    data = {"subject": "Launch sync", "agenda": [], "roles": [], "viewer_lang": "en",
            **({"project_id": project_id} if project_id else {})}
    return {"specversion": "1.0", "id": "00000000-0000-4000-8000-000000000077", "type": "meeting.context",
            "source": "halo/test", "time": "2026-11-13T09:00:00Z", "meetingid": NEW,
            "datacontenttype": "application/json", "data": data}


def service(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    seed_db(data / "events.sqlite", summary=True)
    bus = Bus()
    svc = NotesService(bus, data_dir=data, static_dir=tmp_path)
    return bus, svc, data


def past(data):
    path = data / "references" / f"{NEW}.past.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None


def test_a_project_files_the_meeting_and_writes_its_earlier_meetings(tmp_path):
    bus, svc, data = service(tmp_path)
    folder = svc.create_folder("Launch", MEETING)
    asyncio.run(bus.publish(context(folder["folder_id"])))
    assert svc._load_folders()["meetings"][NEW] == folder["folder_id"]
    got = past(data)
    assert got["project"] == "Launch"
    texts = [line["text"] for line in got["lines"]]
    assert "The launch moves to Nov 12. Layla owns it." in texts and "Launch moves to Nov 12" in texts
    decision = next(line for line in got["lines"] if line["kind"] == "decision")
    assert decision == {"text": "Launch moves to Nov 12", "meeting_id": MEETING,
                        "subject": "Launch date moves to Nov 12", "date": "2025-10-09",
                        "speaker": "Layla", "kind": "decision"}
    assert [t["text"] for t in got["transcript"]] == ["Launch moves to Nov 12.", "Noted, thanks."]


def test_the_meeting_itself_is_never_its_own_past(tmp_path):
    bus, svc, data = service(tmp_path)
    folder = svc.create_folder("Launch")
    asyncio.run(bus.publish(context(folder["folder_id"])))
    assert past(data) is None  # only this meeting in the Project: web check only


def test_no_project_or_an_unknown_one_removes_the_past_notes(tmp_path):
    bus, svc, data = service(tmp_path)
    folder = svc.create_folder("Launch", MEETING)
    asyncio.run(bus.publish(context(folder["folder_id"])))
    assert past(data) is not None
    asyncio.run(bus.publish(context("free text from an old popup")))
    assert past(data) is None and NEW not in svc._load_folders()["meetings"]
    asyncio.run(bus.publish(context(folder["folder_id"])))
    asyncio.run(bus.publish(context(None)))
    assert past(data) is None
