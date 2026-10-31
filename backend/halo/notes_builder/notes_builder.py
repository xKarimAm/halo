"""Notes builder: meeting.ended in, one validated notes.ready out.

On `meeting.ended` the builder assembles a live-path V1 page from Event
Store state (no model call) and runs the background validation checks. A
passing page emits `notes.ready` at once. A failing page triggers exactly
one contributor-shaped rebuild (transcript + candidate points + V1 text +
violations); a passing rebuild emits. When both fail, the meeting's
last-known-good page re-emits; with no LKG the meeting errors out silently
(logged, nothing emitted). Pipelines serialize on a lock so adjacent
meetings cannot interleave; a fresh page emits at most once per meeting.

The Event Store SQLite file is read read-only with plain SQL against the
documented base tables (`meetings`, `turns`, `points`, `tags`, `events`).
No views, no FTS, no writes, and never an import of the owning lane.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator  # type: ignore[import-untyped]

import contracts

log = logging.getLogger("halo.notes_builder")

Envelope = dict[str, Any]
PRIMARY_ENGINE = "spark-open"
PROMPT_CACHE_KEY = "notes-v1"

PAGE_SCHEMA: dict[str, Any] = json.loads(
    (Path(contracts.__file__).parent / "meeting-page.schema.json").read_text(encoding="utf-8")
)
_PAGE_VALIDATOR = Draft202012Validator(PAGE_SCHEMA)

REBUILD_INSTRUCTIONS = (
    "You repair a meeting notes page. Use the store values verbatim: keep "
    "every point_id, turn_id and action linkage; fix only what the violations "
    "list names (missing people rows, broken quote links, wrong field values). "
    "Do not invent people, points, turns, text, or ids. Reply with ONE JSON "
    "object: the full corrected page (meeting, people, points, actions, "
    "transcript_lines, recording)."
)


class NotesBuilder:
    """Assemble, validate, once rebuild, emit. Event-driven; no loop."""

    def __init__(self, bus: Any, llm: Any, *, db_path: Path | str) -> None:
        self._bus = bus
        self._llm = llm
        self._db_path = Path(db_path)
        self._lock = asyncio.Lock()
        self._emitted: set[str] = set()
        self._lkg: dict[str, dict[str, Any]] = {}
        bus.subscribe("meeting.ended", self._on_ended)

    async def _on_ended(self, envelope: Envelope) -> None:
        meetingid = envelope.get("meetingid")
        if not isinstance(meetingid, str):
            return
        async with self._lock:
            await self._process(meetingid)

    async def _process(self, meeting_id: str) -> None:
        store = self._read_store(meeting_id)
        if store is None:
            log.warning("notes: unknown meeting %s, nothing emitted", meeting_id)
            return
        candidate = self.build_v1(meeting_id, store)
        problems = validate_page(candidate, store)
        if not problems:
            await self._emit_fresh(meeting_id, candidate)
            return
        result = await asyncio.to_thread(
            self._llm.complete_json,
            prompt=self.build_rebuild_prompt(candidate, store, problems),
            schema=PAGE_SCHEMA,
            schema_name="notes.page",
            prompt_cache_key=PROMPT_CACHE_KEY,
        )
        if result.ok and isinstance(result.data, dict) and not validate_page(result.data, store):
            await self._emit_fresh(meeting_id, result.data)
            await self._maybe_emit_health(result.engine)
            return
        if meeting_id in self._lkg:
            log.warning("notes: rebuild failed for %s, re-emitting last-known-good", meeting_id)
            await self._emit_page(meeting_id, self._lkg[meeting_id])
        else:
            log.error("notes: rebuild failed for %s with no last-known-good, nothing emitted", meeting_id)

    # -- emission ----------------------------------------------------------

    async def _emit_fresh(self, meeting_id: str, page: dict[str, Any]) -> None:
        self._lkg[meeting_id] = page
        if meeting_id in self._emitted:
            return
        self._emitted.add(meeting_id)
        await self._emit_page(meeting_id, page)

    async def _emit_page(self, meeting_id: str, page: dict[str, Any]) -> None:
        await self._bus.publish(self._notes_ready(meeting_id, page))

    async def _maybe_emit_health(self, engine: str) -> None:
        if engine != PRIMARY_ENGINE:
            await self._bus.publish({
                "specversion": "1.0", "id": str(uuid.uuid4()), "type": "llm.health",
                "source": "halo/notes_builder", "time": datetime.now(UTC).isoformat(),
                "meetingid": None, "datacontenttype": "application/json",
                "data": {"engine": engine, "p90_ms": 0},
            })

    def _notes_ready(self, meeting_id: str, page: dict[str, Any]) -> Envelope:
        meeting = page["meeting"]
        by_owner: dict[str, list[dict[str, Any]]] = {}
        for action in page["actions"]:
            item = {k: v for k, v in action.items() if k != "point_id"}
            by_owner.setdefault(action["owner"], []).append(item)
        people = [{
            "name": person["name"], "role": person["role"], "why": person["why"],
            "relevant_points": person["relevant_points"], "own_points": person["own_points"],
            "actions": by_owner.get(person["name"], []),
        } for person in page["people"]]
        data: dict[str, Any] = {
            "meeting_id": meeting_id,
            "url": f"/notes/{meeting_id}",
            "degraded": meeting["degraded"],
            "people": people,
        }
        if meeting.get("project_id") is not None:
            data["project_id"] = meeting["project_id"]
        return {
            "specversion": "1.0", "id": str(uuid.uuid4()), "type": "notes.ready",
            "source": "halo/notes_builder", "time": datetime.now(UTC).isoformat(),
            "meetingid": meeting_id, "datacontenttype": "application/json", "data": data,
        }

    # -- store read ----------------------------------------------------------

    def _read_store(self, meeting_id: str) -> dict[str, Any] | None:
        # Only the meetings + events base tables are read; the documented
        # points_current / tags_effective semantics (latest-seq wins,
        # replaces drops, user rows win per field) are mirrored below so this
        # lane never imports the owning module.
        try:
            conn = sqlite3.connect(f"file:{self._db_path}?mode=ro", uri=True)
        except sqlite3.OperationalError:
            log.warning("notes: store unreadable at %s", self._db_path)
            return None
        try:
            conn.row_factory = sqlite3.Row
            meeting = conn.execute(
                "SELECT meeting_id, platform, meeting_code, t0_ms, subject, project_id"
                " FROM meetings WHERE meeting_id = ?", (meeting_id,)).fetchone()
            if meeting is None:
                return None
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
                    "text": turn.get("text", ""), "lang": turn.get("lang", "en"),
                    "ts_start_ms": turn.get("ts_start_ms", 0),
                    "ts_end_ms": turn.get("ts_end_ms", 0),
                    "attribution": turn.get("attribution", "provisional"), "seq": seq,
                })
            turns.sort(key=lambda t: (t["ts_start_ms"], t["seq"]))
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
                if isinstance(turn_ids, str):
                    try:
                        turn_ids = json.loads(turn_ids)
                    except ValueError:
                        turn_ids = []
                points.append({
                    "point_id": point["point_id"], "tile_id": point.get("tile_id", ""),
                    "speaker_name": point.get("speaker_name", ""),
                    "kind": point.get("kind", "point"), "text": point.get("text", ""),
                    "lang": point.get("lang", "en"), "quote": point.get("quote", ""),
                    "turn_ids": turn_ids if isinstance(turn_ids, list) else [],
                    "rank": point.get("rank", 3),
                    "attribution": point.get("attribution", "provisional"),
                    "urgency": point.get("urgency", "later"),
                    "is_action": bool(point.get("is_action", False)),
                    "seq": seq,
                })
            points.sort(key=lambda p: (p["rank"], p["seq"]))
            tags: dict[str, dict[str, str]] = {}
            for (data,) in conn.execute(
                    "SELECT data FROM events WHERE type = 'tags.set' ORDER BY seq"):
                try:
                    tag = json.loads(data)
                except ValueError:
                    continue
                if tag.get("target") != "point" or not isinstance(tag.get("target_id"), str):
                    continue
                entry = tags.setdefault(tag["target_id"], {})
                for field in ("kind", "urgency"):
                    if tag.get(field) is not None and (
                            tag.get("source") == "user" or field not in entry):
                        entry[field] = tag[field]
            context: dict[str, Any] = {}
            row = conn.execute(
                "SELECT data FROM events WHERE type = 'meeting.context' AND meetingid = ?"
                " ORDER BY seq DESC LIMIT 1", (meeting_id,)).fetchone()
            if row is not None:
                try:
                    loaded = json.loads(row["data"])
                    context = loaded if isinstance(loaded, dict) else {}
                except ValueError:
                    context = {}
            return {"meeting": dict(meeting), "turns": turns, "points": points,
                    "tags": tags, "context": context}
        finally:
            conn.close()

    # -- V1 assembly ----------------------------------------------------------

    def build_v1(self, meeting_id: str, store: dict[str, Any]) -> dict[str, Any]:
        meeting = store["meeting"]
        t0_ms = meeting["t0_ms"] or 0
        points = []
        for row in store["points"]:
            overlay = store["tags"].get(row["point_id"], {})
            points.append({
                "point_id": row["point_id"], "tile_id": row["tile_id"],
                "speaker_name": row["speaker_name"],
                "kind": overlay.get("kind", row["kind"]),
                "text": row["text"], "quote": row["quote"],
                "turn_ids": list(row["turn_ids"]), "rank": row["rank"],
                "urgency": overlay.get("urgency", row["urgency"]),
                "is_action": bool(row["is_action"]),
            })
        roles = {r.get("name"): r for r in store["context"].get("roles", [])
                 if isinstance(r, dict) and r.get("name")}
        speakers = sorted({t["speaker"] for t in store["turns"]})
        people = []
        for name in speakers:
            own = [p["point_id"] for p in points if p["speaker_name"] == name]
            role = roles.get(name, {}).get("role") or "Participant"
            people.append({"name": name, "role": role, "why": role,
                           "relevant_points": [], "own_points": own})
        actions = [{
            "action_id": str(uuid.uuid4()), "text": p["text"], "owner": p["speaker_name"],
            "status": "assigned", "urgency": p["urgency"], "point_id": p["point_id"],
        } for p in points if p["is_action"]]
        lines = [{
            "turn_id": t["turn_id"], "speaker_name": t["speaker"],
            "text": t["text"], "ts_start_ms": t["ts_start_ms"], "ts_end_ms": t["ts_end_ms"],
            "recording_offset_ms": t["ts_start_ms"] - t0_ms,
        } for t in store["turns"]]
        subject = meeting["subject"] or "Untitled meeting"
        page: dict[str, Any] = {
            "meeting": {"meeting_id": meeting_id, "subject": subject, "degraded": not lines,
                        "t0_ms": t0_ms},
            "people": people, "points": points, "actions": actions,
            "transcript_lines": lines,
            "recording": {"path": f"recordings/{meeting_id}.webm", "start_ts_ms": t0_ms},
        }
        if meeting["project_id"] is not None:
            page["meeting"]["project_id"] = meeting["project_id"]
        return page

    def build_rebuild_prompt(
        self, candidate: dict[str, Any], store: dict[str, Any], problems: list[str]
    ) -> str:
        transcript = [{"turn_id": t["turn_id"], "speaker": t["speaker"], "text": t["text"]}
                      for t in store["turns"]]
        points = [{k: p[k] for k in ("point_id", "speaker_name", "kind", "text", "quote",
                                     "turn_ids", "rank", "urgency", "is_action")} for p in store["points"]]
        return "\n".join([
            REBUILD_INSTRUCTIONS,
            "Transcript: " + json.dumps(transcript),
            "Candidate points: " + json.dumps(points),
            "Current draft page: " + json.dumps(candidate),
            "Violations to fix: " + json.dumps(problems),
        ])


def validate_page(page: dict[str, Any], store: dict[str, Any]) -> list[str]:
    """Background checks. Empty list = the page survives."""
    problems = [e.message for e in _PAGE_VALIDATOR.iter_errors(page)]
    if problems or not isinstance(page, dict):
        return problems
    try:
        store_points = {p["point_id"]: p for p in store["points"]}
        store_turns = {t["turn_id"]: t for t in store["turns"]}
        speakers = {t["speaker"] for t in store["turns"]}
        page_points = {p["point_id"]: p for p in page["points"]}
        page_turns = {line["turn_id"]: line for line in page["transcript_lines"]}
        turn_texts = [t["text"] for t in store["turns"]]
        overlay = store["tags"]
        for pid, claimed in page_points.items():
            row = store_points.get(pid)
            if row is None:
                problems.append(f"point {pid} not in store")
                continue
            for field in ("text", "kind", "rank", "urgency", "is_action"):
                want = overlay.get(pid, {}).get(field, row[field]) if field in ("kind", "urgency") else row[field]
                if claimed.get(field) != want:
                    problems.append(f"point {pid} field {field} mismatch")
            if set(claimed.get("turn_ids", [])) != set(row["turn_ids"]):
                problems.append(f"point {pid} turn_ids mismatch")
            if not claimed.get("turn_ids") or not set(claimed["turn_ids"]) <= set(page_turns):
                problems.append(f"point {pid} traces to no turn")
            if not any(claimed.get("quote", "") in text for text in turn_texts):
                problems.append(f"point {pid} quote not verbatim in turns")
        for tid, line in page_turns.items():
            row = store_turns.get(tid)
            if row is None:
                problems.append(f"turn {tid} not in store")
            elif line.get("text") != row["text"] or line.get("speaker_name") != row["speaker"]:
                problems.append(f"turn {tid} field mismatch")
        for person in page["people"]:
            if person.get("name") not in speakers:
                problems.append(f"person {person.get('name')} not among speakers")
            for pid in person.get("own_points", []) + person.get("relevant_points", []):
                if pid not in page_points:
                    problems.append(f"person {person.get('name')} links unknown point {pid}")
                elif not set(page_points[pid].get("turn_ids", [])) & set(page_turns):
                    problems.append(f"person {person.get('name')} point {pid} traces to no turn")
        for action in page["actions"]:
            if action.get("point_id") not in page_points:
                problems.append(f"action {action.get('action_id')} links unknown point")
            if not action.get("text") or not action.get("owner"):
                problems.append(f"action {action.get('action_id')} missing text/owner")
    except (KeyError, TypeError, ValueError) as exc:
        problems.append(f"page unreadable: {exc!r}")
    return problems
