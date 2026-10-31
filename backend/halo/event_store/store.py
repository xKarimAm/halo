"""Event Store: SQLite tap of every accepted envelope.

Owns the ``events`` table, the ``meetings`` row builder, FTS5 indexes over
final transcripts + latest point text, and the ``points_current`` /
``tags_effective`` views that Notes Builder and Notes Service read read-only.
``events.id`` UNIQUE is the second dedupe line (the Gateway dedupes first).
"""

from __future__ import annotations

import json
import logging
import sqlite3
from pathlib import Path
from typing import Any

log = logging.getLogger("halo.event_store")

Envelope = dict[str, Any]

SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    time TEXT NOT NULL,
    meetingid TEXT,
    source TEXT NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_meeting ON events(meetingid);
CREATE TABLE IF NOT EXISTS meetings (
    meeting_id TEXT PRIMARY KEY,
    platform TEXT,
    meeting_code TEXT,
    t0_ms INTEGER,
    self_name TEXT,
    subject TEXT,
    project_id TEXT,
    ended_at TEXT,
    reason TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS transcript_fts USING fts5(text, seq UNINDEXED);
CREATE VIRTUAL TABLE IF NOT EXISTS points_fts USING fts5(text, seq UNINDEXED);
CREATE VIEW IF NOT EXISTS points_current AS
SELECT
    e.seq AS seq,
    e.meetingid AS meetingid,
    json_extract(e.data, '$.point_id') AS point_id,
    json_extract(e.data, '$.tile_id') AS tile_id,
    json_extract(e.data, '$.speaker_name') AS speaker_name,
    json_extract(e.data, '$.kind') AS kind,
    json_extract(e.data, '$.text') AS text,
    json_extract(e.data, '$.lang') AS lang,
    json_extract(e.data, '$.quote') AS quote,
    json_extract(e.data, '$.turn_ids') AS turn_ids,
    json_extract(e.data, '$.rank') AS rank,
    json_extract(e.data, '$.attribution') AS attribution,
    json_extract(e.data, '$.urgency') AS urgency,
    json_extract(e.data, '$.is_action') AS is_action,
    json_extract(e.data, '$.engine') AS engine,
    json_extract(e.data, '$.replaces') AS replaces
FROM events e
JOIN (
    SELECT json_extract(data, '$.point_id') AS pid, MAX(seq) AS m
    FROM events WHERE type = 'points.upsert' GROUP BY pid
) latest ON latest.pid = json_extract(e.data, '$.point_id') AND latest.m = e.seq
WHERE NOT EXISTS (
    SELECT 1 FROM events r
    WHERE r.type = 'points.upsert'
      AND json_extract(r.data, '$.replaces') = json_extract(e.data, '$.point_id')
);
CREATE VIEW IF NOT EXISTS tags_effective AS
WITH sets AS (
    SELECT
        json_extract(data, '$.target') AS target,
        json_extract(data, '$.target_id') AS target_id,
        json_extract(data, '$.kind') AS kind,
        json_extract(data, '$.urgency') AS urgency,
        json_extract(data, '$.source') AS source,
        seq
    FROM events WHERE type = 'tags.set'
),
latest AS (
    SELECT target, target_id, source, kind, urgency
    FROM sets s
    WHERE seq = (
        SELECT MAX(seq) FROM sets
        WHERE target = s.target AND target_id = s.target_id AND source = s.source
    )
),
user_latest AS (SELECT * FROM latest WHERE source = 'user'),
model_latest AS (SELECT * FROM latest WHERE source = 'model'),
guess AS (
    SELECT 'point' AS target, point_id AS target_id, kind, urgency
    FROM points_current
),
targets AS (
    SELECT target, target_id FROM sets
    UNION
    SELECT target, target_id FROM guess
)
SELECT
    t.target AS target,
    t.target_id AS target_id,
    COALESCE(u.kind, m.kind, g.kind) AS kind,
    COALESCE(u.urgency, m.urgency, g.urgency) AS urgency,
    CASE
        WHEN u.target_id IS NOT NULL THEN 'user'
        WHEN m.target_id IS NOT NULL THEN 'model'
        ELSE 'guess'
    END AS source
FROM targets t
LEFT JOIN user_latest u ON u.target = t.target AND u.target_id = t.target_id
LEFT JOIN model_latest m ON m.target = t.target AND m.target_id = t.target_id
LEFT JOIN guess g ON g.target = t.target AND g.target_id = t.target_id;
"""


class EventStore:
    """SQLite event tap. Create one per backend; readers share the file."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        if self.path.parent != Path("."):
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(self.path))
        self._db.row_factory = sqlite3.Row
        self._db.executescript(SCHEMA)

    def close(self) -> None:
        self._db.close()

    # -- write path ----------------------------------------------------

    def tap(self, envelope: Envelope) -> None:
        """Bus tap: appends every accepted envelope (sync is fine)."""
        self.append(envelope)

    def append(self, envelope: Envelope) -> bool:
        """Store one envelope. False when its id was already stored."""
        cur = self._db.execute(
            "INSERT OR IGNORE INTO events (id, type, time, meetingid, source, data)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (
                envelope.get("id"),
                envelope.get("type"),
                envelope.get("time"),
                envelope.get("meetingid"),
                envelope.get("source"),
                json.dumps(envelope.get("data", {})),
            ),
        )
        if cur.rowcount == 0:
            return False
        seq = cur.lastrowid or 0
        self._index(seq, envelope)
        self._db.commit()
        return True

    def _index(self, seq: int, envelope: Envelope) -> None:
        etype = envelope.get("type")
        data = envelope.get("data", {})
        if etype == "meeting.started":
            self._db.execute(
                "INSERT OR IGNORE INTO meetings"
                " (meeting_id, platform, meeting_code, t0_ms, self_name)"
                " VALUES (?, ?, ?, ?, ?)",
                (
                    data.get("meeting_id"),
                    data.get("platform"),
                    data.get("meeting_code"),
                    data.get("t0_ms"),
                    data.get("self_name"),
                ),
            )
        elif etype == "meeting.context":
            self._db.execute(
                "UPDATE meetings SET subject = ?, project_id = ?"
                " WHERE meeting_id = ? AND (subject IS NULL OR subject != ?)",
                (
                    data.get("subject"),
                    data.get("project_id"),
                    envelope.get("meetingid"),
                    data.get("subject"),
                ),
            )
        elif etype == "meeting.ended":
            self._db.execute(
                "UPDATE meetings SET ended_at = ?, reason = ?"
                " WHERE meeting_id = ? AND ended_at IS NULL",
                (envelope.get("time"), data.get("reason"), envelope.get("meetingid")),
            )
        elif etype == "transcript.final":
            self._db.execute(
                "INSERT INTO transcript_fts (rowid, text, seq) VALUES (?, ?, ?)",
                (seq, data.get("text", ""), seq),
            )
        elif etype == "points.upsert":
            point_id = data.get("point_id")
            # Drop superseded rows: older versions of this point and any
            # point this upsert replaces (a NULL replaces matches nothing).
            self._db.execute(
                "DELETE FROM points_fts WHERE rowid IN"
                " (SELECT seq FROM events WHERE type = 'points.upsert'"
                " AND (json_extract(data, '$.point_id') = ?"
                " OR json_extract(data, '$.point_id') = ?))",
                (point_id, data.get("replaces")),
            )
            text = f"{data.get('text', '')} {data.get('quote', '')}".strip()
            self._db.execute(
                "INSERT INTO points_fts (rowid, text, seq) VALUES (?, ?, ?)",
                (seq, text, seq),
            )

    # -- readers -------------------------------------------------------

    def count(self) -> int:
        row = self._db.execute("SELECT COUNT(*) AS n FROM events").fetchone()
        return int(row["n"])

    def journal_mode(self) -> str:
        row = self._db.execute("PRAGMA journal_mode").fetchone()
        return str(row[0]).lower()

    def get_meeting(self, meeting_id: str) -> dict[str, Any]:
        row = self._db.execute(
            "SELECT * FROM meetings WHERE meeting_id = ?", (meeting_id,)
        ).fetchone()
        return dict(row) if row else {}

    def points_current(self) -> list[dict[str, Any]]:
        return [dict(r) for r in self._db.execute("SELECT * FROM points_current").fetchall()]

    def tags_effective(self) -> list[dict[str, Any]]:
        return [dict(r) for r in self._db.execute("SELECT * FROM tags_effective").fetchall()]

    def search_transcripts(self, query: str, meeting_id: str | None = None) -> list[dict[str, Any]]:
        sql = (
            "SELECT e.seq AS seq, e.meetingid AS meetingid,"
            " json_extract(e.data, '$.turn_id') AS turn_id,"
            " json_extract(e.data, '$.text') AS text"
            " FROM transcript_fts f JOIN events e ON e.seq = f.rowid"
            " WHERE transcript_fts MATCH ?"
        )
        params: list[Any] = [f'"{query}"']
        if meeting_id is not None:
            sql += " AND e.meetingid = ?"
            params.append(meeting_id)
        return [dict(r) for r in self._db.execute(sql, params).fetchall()]

    def search_points(self, query: str) -> list[dict[str, Any]]:
        rows = self._db.execute(
            "SELECT e.seq AS seq, json_extract(e.data, '$.point_id') AS point_id,"
            " json_extract(e.data, '$.text') AS text"
            " FROM points_fts f JOIN events e ON e.seq = f.rowid"
            " WHERE points_fts MATCH ?",
            (f'"{query}"',),
        ).fetchall()
        return [dict(r) for r in rows]

    def health_status(self) -> str:
        return "ok"
