"""Gateway: the backend's only front door and its only socket.

Owns `/ws`, `/pair` and the Host + Origin checks. Control side validates
every envelope against `/contracts`, dedupes by id gateway-wide, publishes
on the bus, then ACKs. Data side (binary, no ACK) routes audio by stream and
rec chunks to the bounded queues wired by the composition root. Builds
`system.status` from `bus.health()` every 5 s and on change, and synthesizes
one `meeting.ended` (`reason: timeout`) per meeting after 60 s with no socket
and no hub `meeting.ended`.
"""

from __future__ import annotations

import asyncio
import itertools
import json
import logging
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse

from halo.bus import Bus
from halo.gateway.audio import AudioRouter
from halo.gateway.pairing import PairingStore
from halo.gateway.session import FORWARD_TYPES, Envelope, SocketSession

log = logging.getLogger("halo.gateway")

_ALLOWED_HOSTS = {"127.0.0.1", "localhost", "[::1]"}

#: Pinned Chrome extension id for the Origin check. Source of truth is the
#: pinned manifest `key` in `wxt.config.ts` (published via issue #27, also in
#: `extension/README`). An explicit `HALO_EXTENSION_ID` overrides this.
PINNED_EXTENSION_ID = "dbngpodihegmipdmikpbkflahdkfpgif"
REPLAY_MAX_AGE_S = 2 * 3600  # an open meeting idle longer was orphaned by a crash

PAIR_PAGE_HTML = (
    "<!doctype html><title>Halo pairing</title>"
    "<h1>Halo pairing</h1><p>Enter the 6-digit code printed by "
    "<code>uv run halo</code> in the Halo extension popup.</p>"
)


def _host_ok(host: str | None) -> bool:
    if not host:
        return False
    name = host.rsplit(":", 1)[0] if not host.startswith("[") else host.split("]")[0] + "]"
    return name in _ALLOWED_HOSTS


async def host_check(request: Request, call_next):  # type: ignore[no-untyped-def]
    if not _host_ok(request.headers.get("host")):
        return JSONResponse({"detail": "foreign host rejected"}, status_code=400)
    return await call_next(request)


class Gateway:
    def __init__(
        self,
        bus: Bus,
        *,
        data_dir: Path | str,
        audio_tab: asyncio.Queue | None = None,
        audio_mic: asyncio.Queue | None = None,
        rec: asyncio.Queue | None = None,
        extension_id: str | None = None,
        timeout_s: float = 60.0,
        status_interval_s: float = 5.0,
    ) -> None:
        self.bus = bus
        self.pairing = PairingStore(data_dir)
        self._events_db = Path(data_dir) / "events.sqlite"
        self.audio = AudioRouter(audio_tab, audio_mic, rec)
        self.extension_id = extension_id or PINNED_EXTENSION_ID
        self._timeout_s = timeout_s
        self._status_interval_s = status_interval_s
        self.sessions: set[SocketSession] = set()
        self.sockets_opened = 0
        self._seen_ids: set[str] = set()
        self._meetings: set[str] = set()
        self._ended: set[str] = set()
        self._timeout_sent: set[str] = set()
        self._generation = 0
        self._tasks: set[asyncio.Task] = set()
        self._last_status: dict[str, Any] | None = None
        bus.subscribe("meeting.started", self._note_started)
        bus.subscribe("meeting.ended", self._note_ended)
        for type_ in FORWARD_TYPES:
            bus.subscribe(type_, self._forward)
        bus.register_health("gateway", self.health)

    # -- pairing / identity -------------------------------------------------

    @property
    def expected_origin(self) -> str:
        return f"chrome-extension://{self.extension_id}"

    def origin_ok(self, origin: str | None) -> bool:
        return origin == self.expected_origin

    @staticmethod
    def new_session_id() -> str:
        return str(uuid.uuid4())

    @staticmethod
    def _now() -> str:
        return datetime.now(UTC).isoformat()

    def envelope(self, type_: str, data: dict[str, Any], meetingid: str | None) -> Envelope:
        return {
            "specversion": "1.0",
            "id": str(uuid.uuid4()),
            "type": type_,
            "source": "halo/gateway",
            "time": self._now(),
            "meetingid": meetingid,
            "datacontenttype": "application/json",
            "data": data,
        }

    def deduped(self, mid: str) -> bool:
        """True when `mid` was already published (resend); else record it."""
        if mid in self._seen_ids:
            return True
        self._seen_ids.add(mid)
        return False

    def health(self) -> dict[str, Any]:
        return {
            "sessions": len(self.sessions),
            "meetings_open": len(self._meetings - self._ended - self._timeout_sent),
            "audio_gaps": self.audio.gaps,
            "audio_dropped": self.audio.dropped,
            "audio_age_s": self.audio.audio_age_s(),
            "sockets_opened": self.sockets_opened,
        }

    # -- sockets ------------------------------------------------------------

    def attach(self, session: SocketSession, sender) -> None:  # type: ignore[no-untyped-def]
        session.sender = sender
        self.sessions.add(session)
        self.sockets_opened += 1
        log.info("extension socket opened (%d open)", len(self.sessions))

    def detach(self, session: SocketSession) -> None:
        self.sessions.discard(session)
        log.info("extension socket closed (%d open)", len(self.sessions))
        if not self.sessions:
            self._schedule_timeout_checks()

    async def broadcast(self, envelope: Envelope) -> None:
        for session in list(self.sessions):
            try:
                await session.send(envelope)
            except Exception:
                log.exception("broadcast to a socket failed")

    async def _forward(self, envelope: Envelope) -> None:
        await self.broadcast(envelope)

    # -- meetings -----------------------------------------------------------

    def _note_started(self, envelope: Envelope) -> None:
        data = envelope.get("data")
        if isinstance(data, dict) and isinstance(data.get("meeting_id"), str):
            self._meetings.add(data["meeting_id"])

    def _note_ended(self, envelope: Envelope) -> None:
        meetingid = envelope.get("meetingid")
        if isinstance(meetingid, str):
            self._ended.add(meetingid)

    async def replay_open_meeting(self) -> None:
        """Issue #57: after a backend restart the hub never resends its ACKed
        `meeting.started`, so on pair.ok republish the latest open meeting's
        stored started (+ latest context) under their original ids. Each id
        goes through `deduped`, so this runs at most once per process and is
        a no-op when this process already saw the meeting from the hub.

        ponytail: the hub's pair.hello carries no meetingid and events carry
        no client id, so "open" is global: the newest started with no ended.
        One user, one hub, one live meeting (the Transcriber holds one).
        """
        rows = self._open_meeting_rows()
        if not rows or rows[0]["id"] in self._seen_ids:
            return
        for row in rows:
            if self.deduped(row["id"]):
                continue
            envelope = {
                "specversion": "1.0", "id": row["id"], "type": row["type"],
                "source": row["source"], "time": row["time"], "meetingid": row["meetingid"],
                "datacontenttype": "application/json", "data": json.loads(row["data"]),
            }
            ack = await self.bus.publish(envelope)
            if ack["status"] != "ok":
                log.warning("replay of stored %s failed: %s", row["type"], ack.get("error"))

    def _open_meeting_rows(self) -> list[sqlite3.Row]:
        if not self._events_db.exists():
            return []
        cols = "id, type, time, meetingid, source, data"
        db = sqlite3.connect(self._events_db.resolve().as_uri() + "?mode=ro", uri=True)
        db.row_factory = sqlite3.Row
        try:
            started = db.execute(
                f"SELECT {cols} FROM events WHERE type = 'meeting.started' AND meetingid NOT IN"
                " (SELECT meetingid FROM events WHERE type = 'meeting.ended'"
                " AND meetingid IS NOT NULL) ORDER BY seq DESC LIMIT 1").fetchone()
            if started is None:
                return []
            last = db.execute("SELECT time FROM events WHERE meetingid = ? ORDER BY seq DESC LIMIT 1",
                              (started["meetingid"],)).fetchone()
            if not _recent(last["time"]):
                log.warning("open-meeting replay: %s idle over %d h, not replayed",
                            started["meetingid"], REPLAY_MAX_AGE_S // 3600)
                return []
            context = db.execute(
                f"SELECT {cols} FROM events WHERE type = 'meeting.context' AND meetingid = ?"
                " ORDER BY seq DESC LIMIT 1", (started["meetingid"],)).fetchone()
        except sqlite3.Error:
            log.exception("open-meeting replay: could not read %s", self._events_db)
            return []
        finally:
            db.close()
        return [started] if context is None else [started, context]

    def _schedule_timeout_checks(self) -> None:
        self._generation += 1
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        for meeting_id in sorted(self._meetings - self._ended - self._timeout_sent):
            task = loop.create_task(self._timeout_watch(meeting_id, self._generation))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

    async def _timeout_watch(self, meeting_id: str, generation: int) -> None:
        await asyncio.sleep(self._timeout_s)
        if generation != self._generation or meeting_id in self._ended:
            return
        if self.sessions or meeting_id in self._timeout_sent:
            return
        self._timeout_sent.add(meeting_id)
        await self.bus.publish(self.envelope("meeting.ended", {"reason": "timeout"}, meeting_id))

    # -- system.status ------------------------------------------------------

    def build_status(self) -> dict[str, Any]:
        health = self.bus.health()
        asr = health.get("asr")
        llm = health.get("llm")
        tagger = health.get("tagger")
        return {
            "asr": asr if asr in ("ok", "reconnecting", "down") else "down",
            "llm": llm if isinstance(llm, dict) and isinstance(llm.get("engine"), str)
            and isinstance(llm.get("failover"), bool)
            else {"engine": "unknown", "failover": False},
            "tagger": tagger if tagger in ("ok", "down") else "down",
        }

    def status_envelope(self) -> Envelope:
        return self.envelope("system.status", self.build_status(), None)

    async def tick_status(self, force: bool = False) -> bool:
        """Emit `system.status` when it changed (or forced). Returns sent."""
        current = self.build_status()
        if not force and current == self._last_status:
            return False
        self._last_status = current
        envelope = self.status_envelope()
        await self.bus.publish(envelope)
        await self.broadcast(envelope)
        return True

    def start(self) -> None:
        task = asyncio.get_running_loop().create_task(self._status_loop())
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def stop(self) -> None:
        for task in list(self._tasks):
            task.cancel()

    async def _status_loop(self) -> None:
        while True:
            await asyncio.sleep(self._status_interval_s)
            await self.tick_status()


router = APIRouter()


@router.get("/pair", response_class=HTMLResponse)
async def pair_page() -> str:
    return PAIR_PAGE_HTML


@router.post("/pair")
async def pair_redeem(request: Request):  # type: ignore[no-untyped-def]
    gateway: Gateway = request.app.state.gateway
    try:
        body = await request.json()
    except ValueError:
        return JSONResponse({"detail": "malformed JSON"}, status_code=400)
    code = body.get("code") if isinstance(body, dict) else None
    if not (isinstance(code, str) and len(code) == 6 and code.isdigit()):
        return JSONResponse({"detail": "code must be a 6-digit string"}, status_code=400)
    token = gateway.pairing.redeem(code)
    if token is None:
        return JSONResponse({"detail": "wrong, used or expired code"}, status_code=401)
    return {"token": token}


_socket_ids = itertools.count(1)


@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket) -> None:
    gateway: Gateway = websocket.app.state.gateway
    if not gateway.origin_ok(websocket.headers.get("origin")):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    session = SocketSession(gateway)
    producer = next(_socket_ids)  # newest socket owns the audio streams

    async def sender(envelope: Envelope) -> None:
        await websocket.send_json(envelope)

    gateway.attach(session, sender)
    try:
        while True:
            message = await websocket.receive()
            if message.get("text") is not None:
                await websocket.send_json(await session.handle_text(message["text"]))
            elif message.get("bytes") is not None:
                gateway.audio.handle(message["bytes"], producer)
            else:
                break
    except WebSocketDisconnect:
        pass
    finally:
        gateway.detach(session)


def _recent(iso_time: str) -> bool:
    """True when an event's envelope time is under REPLAY_MAX_AGE_S old."""
    try:
        at = datetime.fromisoformat(iso_time)
    except ValueError:
        return False
    if at.tzinfo is None:
        at = at.replace(tzinfo=UTC)
    return (datetime.now(UTC) - at).total_seconds() < REPLAY_MAX_AGE_S
