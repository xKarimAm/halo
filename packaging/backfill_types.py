"""Give meetings stored before 2026-11-04 a meeting type (one Spark call each).

    uv run python packaging/backfill_types.py          # back up events.sqlite, then backfill
    uv run python packaging/backfill_types.py --dry    # print the picks, write nothing

New meetings get their type from the Notes Builder at meeting end. This adds
the same field to older ones: for each meeting whose latest `notes.ready` has no
`meeting_type`, Spark picks one from the title, summary and subject, and a copy
of that `notes.ready` with the type is appended to the store (the notes list
reads the latest one). Nothing else is touched; a user's own pick still wins.
"""

from __future__ import annotations

import json
import shutil
import sqlite3
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT)]

from halo.app import load_dotenv
from halo.llm import LLMClient

from contracts.validate import validate_envelope

TYPES = json.loads((ROOT / "contracts" / "notes.ready.schema.json").read_text(encoding="utf-8"))[
    "properties"]["meeting_type"]["enum"]
SCHEMA = {"type": "object", "properties": {"meeting_type": {"type": "string", "enum": TYPES}},
          "required": ["meeting_type"], "additionalProperties": False}
PROMPT = (
    "Pick the meeting type. sprint (sprint review, standup or retro), planning (roadmap, "
    "launch or scheduling), discovery (product discovery or user research), sales (a customer "
    "or prospect call), induction (onboarding someone new), one_on_one (two people about work "
    "or growth), interview (hiring), or other.\n\nSubject: {subject}\nTitle: {title}\nSummary: {summary}"
)


def main(dry: bool) -> int:
    sys.stdout.reconfigure(encoding="utf-8")  # Arabic titles on a Windows console
    load_dotenv()
    db = ROOT / "data" / "events.sqlite"
    if not db.exists():
        print(f"no store at {db}")
        return 1
    if not dry:
        backup = db.with_name(f"events.backup-{datetime.now():%Y%m%d-%H%M}-types.sqlite")
        shutil.copy2(db, backup)
        print(f"backup: {backup.name}")
    conn = sqlite3.connect(str(db), timeout=10)
    subjects = dict(conn.execute("SELECT meeting_id, subject FROM meetings"))
    rows = conn.execute(
        "SELECT e.meetingid, e.data FROM events e JOIN (SELECT meetingid, MAX(seq) AS seq FROM events"
        " WHERE type = 'notes.ready' GROUP BY meetingid) last ON e.seq = last.seq").fetchall()
    llm = LLMClient()
    done = 0
    for meeting_id, raw in rows:
        data = json.loads(raw)
        if data.get("meeting_type") in TYPES:
            continue
        result = llm.complete_json(
            prompt=PROMPT.format(subject=subjects.get(meeting_id) or "none",
                                 title=data.get("title") or "none", summary=data.get("summary") or "none"),
            schema=SCHEMA, schema_name="notes.meeting_type")
        if not result.ok:
            print(f"  {meeting_id}: no pick ({result.error})")
            continue
        kind = result.data["meeting_type"]
        print(f"  {kind:<11} {data.get('title') or subjects.get(meeting_id)}")
        if dry:
            continue
        env = {"specversion": "1.0", "id": str(uuid.uuid4()), "type": "notes.ready",
               "source": "halo/backfill", "time": datetime.now(UTC).isoformat(), "meetingid": meeting_id,
               "datacontenttype": "application/json", "data": {**data, "meeting_type": kind}}
        if errors := validate_envelope(env):
            print(f"  {meeting_id}: skipped, {errors[0]}")
            continue
        conn.execute(
            "INSERT INTO events (id, type, time, meetingid, source, data) VALUES (?, ?, ?, ?, ?, ?)",
            (env["id"], env["type"], env["time"], meeting_id, env["source"],
             json.dumps(env["data"], ensure_ascii=False)))
        conn.commit()
        done += 1
    usage = llm.usage()
    print(f"{done} meetings typed; estimated ${usage['usd_total']:.3f}.")
    llm.close()
    return 0


if __name__ == "__main__":
    sys.exit(main("--dry" in sys.argv))
