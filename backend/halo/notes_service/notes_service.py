"""Notes HTTP service: shell, page JSON, list, search, tags, audio.

Read-only over the Event Store SQLite file (`meetings` + `events`; the
documented points/tags semantics mirrored in Python, own copy — lane
independence), plus the static `notes-page/` dir and the `recordings/`
files. The only write path is `POST /api/tags`, which publishes `tags.set`
(`source: user`) on the bus. No `notes.ready` consumption: the page is
assembled here; people/actions prefer the latest stored `notes.ready`
event, falling back to live state before the builder runs.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import ValidationError

from contracts.gen.pydantic.models import MeetingPage

log = logging.getLogger("halo.notes_service")

Envelope = dict[str, Any]
SEARCH_CAP = 100

KINDS = ("point", "question", "decision", "pushback")
URGENCIES = ("urgent", "medium", "later")


def action_id_for(point_id: str) -> str:
    """Stable action ids: deterministic over the point, shared with notes_builder."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"halo-action:{point_id}"))


class NotesService:
    """Stateless HTTP reads over the store file. Constructed by app.py."""

    def __init__(
        self,
        bus: Any,
        *,
        data_dir: Path | str | None = None,
        static_dir: Path | str | None = None,
    ) -> None:
        self._bus = bus
        self._data_dir = Path(data_dir) if data_dir is not None else Path(
            os.environ.get("HALO_DATA_DIR") or "data")
        self._db_path = self._data_dir / "events.sqlite"
        if static_dir is not None:
            self._static = Path(static_dir)
        else:
            self._static = Path(__file__).resolve().parents[3] / "notes-page"

    # -- store reads --------------------------------------------------------

    def _connect(self) -> sqlite3.Connection | None:
        try:
            return sqlite3.connect(f"file:{self._db_path}?mode=ro", uri=True)
        except sqlite3.OperationalError:
            return None

    def _read_meeting(self, conn: sqlite3.Connection, meeting_id: str) -> dict[str, Any] | None:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT meeting_id, platform, meeting_code, t0_ms, subject, project_id, ended_at"
            " FROM meetings WHERE meeting_id = ?", (meeting_id,)).fetchone()
        if row is None:
            return None
        meeting = dict(row)
        turns = self._turns(conn, meeting_id)
        points = self._points(conn, meeting_id)
        tags = self._tags(conn, [p["point_id"] for p in points])
        context = self._context(conn, meeting_id)
        ready = self._latest_ready(conn, meeting_id)
        return {"meeting": meeting, "turns": turns, "points": points,
                "tags": tags, "context": context, "ready": ready}

    def _turns(self, conn: sqlite3.Connection, meeting_id: str) -> list[dict[str, Any]]:
        turns = []
        for seq, (data,) in enumerate(conn.execute(
                "SELECT data FROM events WHERE type = 'turn.attributed' AND meetingid = ?"
                " ORDER BY seq", (meeting_id,))):
            try:
                turn = json.loads(data)
            except ValueError:
                continue
            if not isinstance(turn.get("turn_id"), str):
                continue
            turns.append({
                "turn_id": turn["turn_id"], "speaker": turn.get("name", ""),
                "text": turn.get("text", ""), "ts_start_ms": turn.get("ts_start_ms", 0),
                "ts_end_ms": turn.get("ts_end_ms", 0), "seq": seq})
        turns.sort(key=lambda t: (t["ts_start_ms"], t["seq"]))
        return turns

    def _points(self, conn: sqlite3.Connection, meeting_id: str) -> list[dict[str, Any]]:
        latest: dict[str, tuple[int, dict[str, Any]]] = {}
        for seq, (data,) in enumerate(conn.execute(
                "SELECT data FROM events WHERE type = 'points.upsert' AND meetingid = ?"
                " ORDER BY seq", (meeting_id,))):
            try:
                point = json.loads(data)
            except ValueError:
                continue
            if isinstance(point.get("point_id"), str):
                latest[point["point_id"]] = (seq, point)
        superseded = {p.get("replaces") for _, p in latest.values() if p.get("replaces")}
        points = []
        for seq, point in sorted(latest.values()):
            if point["point_id"] in superseded:
                continue
            turn_ids = point.get("turn_ids", [])
            points.append({
                "point_id": point["point_id"], "tile_id": point.get("tile_id", ""),
                "speaker_name": point.get("speaker_name", ""),
                "kind": point.get("kind", "point"), "text": point.get("text", ""),
                "quote": point.get("quote", ""),
                "turn_ids": list(turn_ids) if isinstance(turn_ids, list) else [],
                "rank": point.get("rank", 3),
                "urgency": point.get("urgency", "later"),
                "is_action": bool(point.get("is_action", False)), "seq": seq})
        points.sort(key=lambda p: (p["rank"], p["seq"]))
        return points

    def _tags(self, conn: sqlite3.Connection, point_ids: list[str]) -> dict[str, dict[str, str]]:
        tags: dict[str, dict[str, str]] = {}
        for (data,) in conn.execute("SELECT data FROM events WHERE type = 'tags.set' ORDER BY seq"):
            try:
                tag = json.loads(data)
            except ValueError:
                continue
            if tag.get("target") != "point" or tag.get("target_id") not in point_ids:
                continue
            entry = tags.setdefault(tag["target_id"], {})
            for field in ("kind", "urgency"):
                if tag.get(field) is not None and (
                        tag.get("source") == "user" or field not in entry):
                    entry[field] = tag[field]
        return tags

    def _context(self, conn: sqlite3.Connection, meeting_id: str) -> dict[str, Any]:
        row = conn.execute(
            "SELECT data FROM events WHERE type = 'meeting.context' AND meetingid = ?"
            " ORDER BY seq DESC LIMIT 1", (meeting_id,)).fetchone()
        if row is None:
            return {}
        try:
            loaded = json.loads(row["data"])
        except ValueError:
            return {}
        return loaded if isinstance(loaded, dict) else {}

    def _latest_ready(self, conn: sqlite3.Connection, meeting_id: str) -> dict[str, Any] | None:
        row = conn.execute(
            "SELECT data FROM events WHERE type = 'notes.ready' AND meetingid = ?"
            " ORDER BY seq DESC LIMIT 1", (meeting_id,)).fetchone()
        if row is None:
            return None
        try:
            loaded = json.loads(row["data"])
        except ValueError:
            return None
        return loaded if isinstance(loaded, dict) else None

    # -- page ---------------------------------------------------------------

    def page_for(self, meeting_id: str) -> dict[str, Any] | None:
        """The #14 page JSON, or None for an unknown meeting."""
        conn = self._connect()
        if conn is None:
            return None
        try:
            store = self._read_meeting(conn, meeting_id)
        finally:
            conn.close()
        if store is None:
            return None
        meeting, turns, points = store["meeting"], store["turns"], store["points"]
        tags, context, ready = store["tags"], store["context"], store["ready"]
        t0_ms = meeting["t0_ms"] or 0
        for point in points:
            overlay = tags.get(point["point_id"], {})
            point["kind"] = overlay.get("kind", point["kind"])
            point["urgency"] = overlay.get("urgency", point["urgency"])
        ready_actions: dict[str, dict[str, Any]] = {}
        if ready:
            for person in ready.get("people", []):
                for action in person.get("actions", []):
                    if isinstance(action, dict) and action.get("action_id"):
                        ready_actions[action["action_id"]] = action
        actions = []
        for point in points:
            if not point["is_action"]:
                continue
            item = {
                "action_id": action_id_for(point["point_id"]), "text": point["text"],
                "owner": point["speaker_name"], "status": "suggested",
                "urgency": point["urgency"], "point_id": point["point_id"],
            }
            stored = ready_actions.get(item["action_id"])
            if stored:
                item.update({k: stored[k] for k in ("text", "owner", "status", "urgency")
                             if stored.get(k) is not None})
            actions.append(item)
        if ready:
            # The #14 page keeps actions top-level only: strip the builder's
            # per-person nested actions (flattened into page["actions"] above
            # via the action_id match) so people validate against the schema.
            people = [{
                "name": person.get("name", ""), "role": person.get("role", ""),
                "why": person.get("why", ""),
                "relevant_points": person.get("relevant_points", []),
                "own_points": person.get("own_points", []),
            } for person in ready.get("people", []) if isinstance(person, dict)]
            degraded = bool(ready.get("degraded", False))
        else:
            roles = {r.get("name"): r for r in context.get("roles", [])
                     if isinstance(r, dict) and r.get("name")}
            people = [{
                "name": name, "role": roles.get(name, {}).get("role") or "Participant",
                "why": roles.get(name, {}).get("role") or "Participant",
                "relevant_points": [],
                "own_points": [p["point_id"] for p in points if p["speaker_name"] == name],
            } for name in sorted({t["speaker"] for t in turns})]
            degraded = True
        subject = meeting["subject"] or "Untitled meeting"
        page: dict[str, Any] = {
            "meeting": {"meeting_id": meeting_id, "subject": subject,
                        "degraded": degraded, "t0_ms": t0_ms},
            "people": people,
            "points": [{
                "point_id": p["point_id"], "tile_id": p["tile_id"],
                "speaker_name": p["speaker_name"], "kind": p["kind"], "text": p["text"],
                "quote": p["quote"], "turn_ids": p["turn_ids"], "rank": p["rank"],
                "urgency": p["urgency"], "is_action": p["is_action"],
            } for p in points],
            "actions": actions,
            "transcript_lines": [{
                "turn_id": t["turn_id"], "speaker_name": t["speaker"],
                "text": t["text"], "ts_start_ms": t["ts_start_ms"],
                "ts_end_ms": t["ts_end_ms"],
                "recording_offset_ms": t["ts_start_ms"] - t0_ms,
            } for t in turns],
            "recording": {"path": f"recordings/{meeting_id}.webm", "start_ts_ms": t0_ms},
        }
        if meeting["project_id"] is not None:
            page["meeting"]["project_id"] = meeting["project_id"]
        return page

    # -- list / search ---------------------------------------------------------

    def list_meetings(self, project_id: str | None = None) -> list[dict[str, Any]]:
        conn = self._connect()
        if conn is None:
            return []
        try:
            conn.row_factory = sqlite3.Row
            if project_id is not None:
                rows = conn.execute(
                    "SELECT meeting_id, subject, project_id, t0_ms FROM meetings"
                    " WHERE project_id = ? ORDER BY t0_ms DESC", (project_id,))
            else:
                rows = conn.execute(
                    "SELECT meeting_id, subject, project_id, t0_ms FROM meetings"
                    " ORDER BY t0_ms DESC")
            out = []
            for row in rows:
                meeting = dict(row)
                turns = self._turns(conn, meeting["meeting_id"])
                seen: list[str] = []
                for turn in turns:
                    if turn["speaker"] not in seen:
                        seen.append(turn["speaker"])
                out.append({
                    "meeting_id": meeting["meeting_id"],
                    "subject": meeting["subject"] or "Untitled meeting",
                    "people": seen,
                    "date": datetime.fromtimestamp(
                        (meeting["t0_ms"] or 0) / 1000, UTC).strftime("%a %d %b"),
                })
            return out
        finally:
            conn.close()

    def search(self, query: str) -> list[dict[str, Any]]:
        needle = query.lower()
        conn = self._connect()
        if conn is None:
            return []
        try:
            conn.row_factory = sqlite3.Row
            meetings = [dict(r) for r in conn.execute(
                "SELECT meeting_id, subject, t0_ms FROM meetings ORDER BY t0_ms DESC")]
            hits: list[dict[str, Any]] = []
            for meeting in meetings:
                mid = meeting["meeting_id"]
                subject = meeting["subject"] or "Untitled meeting"
                turns = self._turns(conn, mid)
                points = self._points(conn, mid)
                tags = self._tags(conn, [p["point_id"] for p in points])
                for turn in turns:
                    if needle in turn["text"].lower():
                        hits.append({
                            "meeting_id": mid, "subject": subject,
                            "snippet": _snippet(turn["text"], needle),
                            "line": turn["turn_id"], "speaker": turn["speaker"],
                            "scope": "transcript", "kindLabel": ""})
                for point in points:
                    overlay = tags.get(point["point_id"], {})
                    kind = overlay.get("kind", point["kind"])
                    urgency = overlay.get("urgency", point["urgency"])
                    for text in (point["text"], point["quote"]):
                        if text and needle in text.lower():
                            line = next(
                                (tid for tid in point["turn_ids"]
                                 if any(t["turn_id"] == tid for t in turns)),
                                point["point_id"])
                            hits.append({
                                "meeting_id": mid, "subject": subject,
                                "snippet": _snippet(text, needle), "line": line,
                                "speaker": point["speaker_name"], "scope": "point",
                                "kind": kind, "urgency": urgency, "kindLabel": kind})
                            break
                    if point["is_action"] and needle in point["text"].lower():
                        line = next(
                            (tid for tid in point["turn_ids"]
                             if any(t["turn_id"] == tid for t in turns)),
                            point["point_id"])
                        hits.append({
                            "meeting_id": mid, "subject": subject,
                            "snippet": _snippet(point["text"], needle), "line": line,
                            "speaker": point["speaker_name"], "scope": "action",
                            "urgency": urgency, "kindLabel": urgency})
                if len(hits) >= SEARCH_CAP:
                    break
            return hits[:SEARCH_CAP]
        finally:
            conn.close()

    # -- tags / audio targets ----------------------------------------------------

    def resolve_target(self, target: str, target_id: str) -> str | None:
        """The target's meeting, or None when unknown."""
        conn = self._connect()
        if conn is None:
            return None
        try:
            for (data,) in conn.execute(
                    "SELECT data FROM events WHERE type = 'points.upsert' ORDER BY seq"):
                try:
                    point = json.loads(data)
                except ValueError:
                    continue
                if point.get("point_id") == target_id and (
                        target == "point" or (target == "action" and point.get("is_action"))):
                    for (meetingid,) in conn.execute(
                            "SELECT meetingid FROM events WHERE type = 'points.upsert'"
                            " AND json_extract(data, '$.point_id') = ? ORDER BY seq DESC LIMIT 1",
                            (target_id,)):
                        return meetingid
            if target == "action":
                for (data, meetingid) in conn.execute(
                        "SELECT data, meetingid FROM events WHERE type = 'notes.ready' ORDER BY seq"):
                    try:
                        ready = json.loads(data)
                    except ValueError:
                        continue
                    for person in ready.get("people", []):
                        for action in person.get("actions", []):
                            if action.get("action_id") == target_id:
                                return meetingid
            return None
        finally:
            conn.close()

    def audio_state(self, meeting_id: str) -> tuple[str, Path | None]:
        """One of active|ready|unknown|missing-file plus the file when ready."""
        conn = self._connect()
        if conn is None:
            return "unknown", None
        try:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT ended_at FROM meetings WHERE meeting_id = ?", (meeting_id,)).fetchone()
        finally:
            conn.close()
        if row is None:
            return "unknown", None
        if row["ended_at"] is None:
            return "active", None
        path = self._data_dir / "recordings" / f"{meeting_id}.webm"
        if not path.is_file():
            return "missing-file", None
        return "ready", path

    def static_file(self, name: str) -> Path | None:
        path = self._static / name
        return path if path.is_file() else None


def _snippet(text: str, needle: str, window: int = 60) -> str:
    at = text.lower().find(needle)
    if at < 0:
        return text[: 2 * window]
    start, end = max(0, at - window), at + len(needle) + window
    return text[start:end]


router = APIRouter()


def _service(request: Request) -> NotesService:
    return request.app.state.notes_service


@router.get("/notes/app.js")
async def notes_app_js(request: Request):  # type: ignore[no-untyped-def]
    path = _service(request).static_file("app.js")
    if path is None:
        return JSONResponse({"detail": "notes shell not found"}, status_code=404)
    return FileResponse(path, media_type="application/javascript")


@router.get("/notes/styles.css")
async def notes_styles(request: Request):  # type: ignore[no-untyped-def]
    path = _service(request).static_file("styles.css")
    if path is None:
        return JSONResponse({"detail": "notes shell not found"}, status_code=404)
    return FileResponse(path, media_type="text/css")


@router.get("/notes/{meeting_id}")
async def notes_shell(meeting_id: str, request: Request):  # type: ignore[no-untyped-def]
    service = _service(request)
    if service.page_for(meeting_id) is None:
        return JSONResponse({"detail": "unknown meeting"}, status_code=404)
    path = service.static_file("index.html")
    if path is None:
        return JSONResponse({"detail": "notes shell not found"}, status_code=404)
    return FileResponse(path, media_type="text/html")


@router.get("/api/meetings")
async def api_meetings(request: Request, project_id: str | None = None):  # type: ignore[no-untyped-def]
    return _service(request).list_meetings(project_id)


@router.get("/api/meetings/{meeting_id}")
async def api_meeting_page(meeting_id: str, request: Request):  # type: ignore[no-untyped-def]
    service = _service(request)
    page = service.page_for(meeting_id)
    if page is None:
        return JSONResponse({"detail": "unknown meeting"}, status_code=404)
    try:
        MeetingPage.model_validate(page)
    except ValidationError as exc:
        log.error("notes: assembled page for %s fails schema: %s", meeting_id, exc.errors())
        return JSONResponse({"detail": "page failed validation"}, status_code=500)
    return page


@router.get("/api/search")
async def api_search(request: Request, q: str | None = None):  # type: ignore[no-untyped-def]
    if q is None:
        return JSONResponse({"detail": "missing q"}, status_code=400)
    if not q.strip():
        return {"hits": []}
    return {"hits": _service(request).search(q.strip())}


@router.post("/api/tags", status_code=201)
async def api_tags(request: Request):  # type: ignore[no-untyped-def]
    service = _service(request)
    try:
        body = await request.json()
    except ValueError:
        return JSONResponse({"detail": "malformed JSON"}, status_code=400)
    if not isinstance(body, dict):
        return JSONResponse({"detail": "malformed body"}, status_code=400)
    target, target_id = body.get("target"), body.get("target_id")
    kind, urgency = body.get("kind"), body.get("urgency")
    if target not in ("point", "action") or not isinstance(target_id, str):
        return JSONResponse({"detail": "target/target_id required"}, status_code=422)
    if (kind is not None and kind not in KINDS) or (urgency is not None and urgency not in URGENCIES):
        return JSONResponse({"detail": "bad kind/urgency"}, status_code=422)
    if kind is None and urgency is None:
        return JSONResponse({"detail": "kind or urgency required"}, status_code=422)
    meeting_id = service.resolve_target(target, target_id)
    if meeting_id is None:
        return JSONResponse({"detail": "unknown target"}, status_code=404)
    data: dict[str, Any] = {"target": target, "target_id": target_id, "source": "user"}
    if kind is not None:
        data["kind"] = kind
    if urgency is not None:
        data["urgency"] = urgency
    envelope = {
        "specversion": "1.0", "id": str(uuid.uuid4()), "type": "tags.set",
        "source": "halo/notes_service", "time": datetime.now(UTC).isoformat(),
        "meetingid": meeting_id, "datacontenttype": "application/json", "data": data,
    }
    await service._bus.publish(envelope)
    return envelope


@router.get("/api/audio")
async def api_audio(request: Request, meeting_id: str | None = None,  # type: ignore[no-untyped-def]
                    turn_id: str | None = None):
    service = _service(request)
    if not meeting_id:
        return JSONResponse({"detail": "meeting_id required"}, status_code=400)
    if turn_id is not None:
        return JSONResponse({"detail": "turn-level audio needs the recorder index"},
                            status_code=501)
    state, path = service.audio_state(meeting_id)
    if state == "unknown":
        return JSONResponse({"detail": "unknown meeting"}, status_code=404)
    if state == "active":
        return JSONResponse({"detail": "meeting still active"}, status_code=429)
    if state == "missing-file" or path is None:
        return JSONResponse({"detail": "no recording yet"}, status_code=404)
    return FileResponse(path, media_type="audio/webm",
                        filename=f"{meeting_id}.webm")
