"""Verification gate 7: resilience as automated rig tests.

1. Socket drop: the extension<->Gateway socket drops mid-meeting -> the hub
   resends every unacked envelope on reconnect, the Gateway dedupes by id,
   events.sqlite has no duplicates and no gaps; audio resumes. (The hub's
   own reconnect half — backoff, pair.hello first, resendAll — is covered by
   extension/src/hub_capture/hub.test.ts; here a python client mimics the hub
   against the real backend.)
2. Backend restart: kill and restart the backend mid-meeting -> the client
   reconnects with its persisted pairing token (no re-pair) and the meeting
   continues under the same meetingid.
3. LLM failover: the primary returns 5xx -> the client fails over to the
   contributor, points keep flowing with the failover engine, llm.health
   shows failover, and the primary is tried again after the 30 s cooldown.
   (Timeout / missing-key / 401 failover mechanics are pinned fast in
   backend/halo/llm/tests/test_llm.py; here they run end to end over the wire.)
4. Voice drop: the fake Voice server closes the session mid-turn
   (control.drop) -> the turn in flight still completes on reconnect, exactly
   once, with no turnId reuse.

All four run offline on ephemeral ports (HALO_FAKE_PORT + free backend
ports), so parallel runs never share a fake server or collide with a live
dev backend on 8765/18777. Real time, no browser.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import socket
import threading
import time
import urllib.request
import uuid
from pathlib import Path
from typing import Any

import uvicorn
import websockets
from halo.gateway.gateway import PINNED_EXTENSION_ID
from halo.llm.llm import ENGINES, FAILOVER_ENGINE, PRIMARY_ENGINE
from halo.transcriber.protocol import DIARIZATION, TurnAssembler, build_handshake
from websockets.exceptions import ConnectionClosed

from contracts.binary import pack_audio
from rig.fakes.fake_llm import FakeLLM
from rig.fakes.scripts import AsrTurn, LlmReply
from rig.fakes.server import create_asr_app, create_llm_app
from rig.replayer.joined import read_events

MEETING = "33333333-3333-4333-8333-333333333333"
TILE = "spaces/x/devices/9"
ORIGIN = f"chrome-extension://{PINNED_EXTENSION_ID}"
FRAME = b"\x00\x00" * 1600  # 100 ms of PCM16 silence
PRIMARY_MODEL = ENGINES[PRIMARY_ENGINE]["model"]
FAILOVER_MODEL = ENGINES[FAILOVER_ENGINE]["model"]


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class ServedApp:
    """A FastAPI app on a background uvicorn thread. The owner stops it.

    The app is built by a factory INSIDE the serving thread: every asyncio
    handler then shares that one thread, which the sqlite-backed EventStore
    requires (its connection may only be used where it was created).
    """

    def __init__(self, factory: Any, port: int) -> None:
        self.port = port
        self.app: Any = None
        self._server: Any = None
        self._factory = factory
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        self.app = self._factory()
        self._server = uvicorn.Server(
            uvicorn.Config(self.app, host="127.0.0.1", port=self.port,
                           log_level="error"))
        self._server.run()

    def start(self) -> None:
        self._thread.start()
        deadline = time.monotonic() + 30
        while self._server is None or not self._server.started:
            assert time.monotonic() < deadline, "server did not start"
            time.sleep(0.05)

    def stop(self) -> None:
        self._server.should_exit = True
        self._thread.join(timeout=30)


def serve_fakes(port: int, asr_turns: list[AsrTurn], llm_replies: list[LlmReply],
                llm_errors: dict[str, int] | None = None) -> tuple[ServedApp, dict]:
    errors: dict[str, int] = dict(llm_errors or {})

    def factory() -> Any:
        asr_app = create_asr_app(list(asr_turns))
        llm_app = create_llm_app(FakeLLM(list(llm_replies)), errors_by_model=errors)
        llm_app.router.routes.extend(asr_app.router.routes)
        return llm_app

    served = ServedApp(factory, port)
    served.start()
    return served, errors


def serve_backend(monkeypatch: Any, data_dir: Path, fakes_port: int,
                  port: int | None = None) -> tuple[ServedApp, str]:
    from halo.app import create_app

    monkeypatch.setenv("HALO_FAKES", "1")
    monkeypatch.setenv("HALO_FAKE_PORT", str(fakes_port))
    monkeypatch.setenv("HALO_DATA_DIR", str(data_dir))
    monkeypatch.setenv("BASETEN_API_KEY", "gate7-dummy")
    monkeypatch.setenv("META_API_KEY", "gate7-dummy")
    served = ServedApp(create_app, port if port is not None else free_port())
    served.start()
    assert served.app is not None
    return served, served.app.state.gateway.pairing.current_code


def redeem(port: int, code: str) -> str:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/pair", data=json.dumps({"code": code}).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read())["token"]


def envelope(type_: str, data: dict, meetingid: str | None, id: str) -> dict:
    return {
        "specversion": "1.0", "id": id, "type": type_, "source": "halo/gate7",
        "time": "2026-10-31T09:00:00Z", "meetingid": meetingid,
        "datacontenttype": "application/json", "data": data,
    }


def started_env(id: str, t0: int) -> dict:
    return envelope("meeting.started", {
        "meeting_id": MEETING, "platform": "meet", "meeting_code": "gate7",
        "t0_ms": t0, "self_name": "Karim Amer"}, MEETING, id)


def tiles_env(id: str) -> dict:
    return envelope("tiles.snapshot", {"tiles": [{
        "tile_id": TILE, "name": "Layla", "is_self": False,
        "rect": [416, 8, 400, 225], "video_w": 640, "video_h": 360,
        "fit": "cover", "captions_rect": None}]}, MEETING, id)


def context_env(id: str) -> dict:
    return envelope("meeting.context", {
        "subject": "Gate seven", "agenda": [], "roles": [],
        "viewer_lang": "en"}, MEETING, id)


def active_env(id: str, ts: int) -> dict:
    return envelope("speaker.active", {
        "tile_id": TILE, "speaking": True, "ts_ms": ts}, MEETING, id)


class HubSocket:
    """Mimics the hub: pair.hello, same-id resends, binary audio."""

    def __init__(self, port: int) -> None:
        from websockets.sync.client import connect

        self._connect = connect
        self.port = port
        self.ws: Any = None

    def connect(self, token: str) -> None:
        self.ws = self._connect(
            f"ws://127.0.0.1:{self.port}/ws", additional_headers={"Origin": ORIGIN})
        hello = envelope("pair.hello", {"token": token, "ext_version": "gate7"},
                         None, str(uuid.uuid4()))
        self.ws.send(json.dumps(hello))
        reply = json.loads(self.ws.recv(timeout=15))
        assert reply.get("type") == "pair.ok", f"pairing rejected: {reply}"

    def send(self, env: dict) -> None:
        self.ws.send(json.dumps(env))

    def send_audio(self, stream: int, t0: int, n_frames: int, start_seq: int = 0) -> None:
        for i in range(n_frames):
            self.ws.send(pack_audio(stream, start_seq + i, t0 + i * 100, FRAME))

    def pump(self, duration_s: float) -> tuple[dict[str, dict], list[dict]]:
        """Read for a while; returns (acks by ack_of, other envelopes)."""
        acks: dict[str, dict] = {}
        others: list[dict] = []
        deadline = time.monotonic() + duration_s
        while True:
            try:
                msg = json.loads(self.ws.recv(timeout=max(0.1, deadline - time.monotonic())))
            except TimeoutError:
                return acks, others
            if isinstance(msg, dict) and "ack_of" in msg:
                acks[str(msg["ack_of"])] = msg
            elif isinstance(msg, dict):
                others.append(msg)
            if time.monotonic() >= deadline:
                return acks, others

    def close(self) -> None:
        ws, self.ws = self.ws, None
        if ws is None:
            return
        with contextlib.suppress(ConnectionClosed, OSError):
            ws.close()


def wait_for(predicate: Any, timeout: float, what: str) -> Any:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.25)
    raise TimeoutError(f"timed out waiting for {what}")


def read_stored(data_dir: Path) -> list[dict]:
    """read_events with a short retry: the backend holds its own sqlite
    connection in another thread and a write may briefly lock reads."""
    import sqlite3

    deadline = time.monotonic() + 10
    while True:
        try:
            return read_events(data_dir)
        except sqlite3.OperationalError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.1)


def events_of(data_dir: Path, type_: str) -> list[dict]:
    return [e for e in read_stored(data_dir) if e["type"] == type_]


def classifier_replies(n: int) -> list[LlmReply]:
    return [LlmReply(match="assign tags to a meeting point",
                     response={"kind": "point", "urgency": "medium"})
            for _ in range(n)]


def test_socket_drop_resends_without_dup_or_gap(monkeypatch: Any, tmp_path: Path) -> None:
    """Gate 7.1: ~5 s socket drop -> same-id resends dedupe; no dup, no gaps."""
    fakes_port = free_port()
    fakes, _ = serve_fakes(fakes_port, [
        AsrTurn(stream="tab", speaker="A", text="hello world", lang="en",
                ts_start_ms=100, ts_end_ms=900),
    ], [])
    data_dir = tmp_path / "data"
    backend, code = serve_backend(monkeypatch, data_dir, fakes_port)
    hub = HubSocket(backend.port)
    try:
        token = redeem(backend.port, code)
        hub.connect(token)
        t0 = int(time.time() * 1000)
        first = [started_env("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", t0),
                 tiles_env("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
                 context_env("cccccccc-cccc-4ccc-8ccc-cccccccccccc")]
        for env in first:
            hub.send(env)
        hub.close()  # brutal drop: none of the ACKs are processed
        time.sleep(5)
        hub.connect(token)  # same single-use code is spent; the token reconnects
        for env in first:  # hub outbox resends every unacked envelope, same ids
            hub.send(env)
        acks, _ = hub.pump(10)
        for env in first:
            assert acks[env["id"]]["status"] == "ok", f"no ok ACK for {env['id']}"
        stored = read_stored(data_dir)
        for env in first:
            assert sum(1 for e in stored if e["id"] == env["id"]) == 1, (
                f"envelope {env['id']} duplicated or lost in events.sqlite")
        hub.send(active_env("dddddddd-dddd-4ddd-8ddd-dddddddddddd", t0 + 1000))
        hub.send_audio(0, t0, 15)  # audio resumes on the reconnected socket
        finals = wait_for(
            lambda: events_of(data_dir, "transcript.final"), 20, "transcript.final")
        assert len(finals) == 1 and finals[0]["data"]["text"] == "hello world"
        assert events_of(data_dir, "meeting.ended") == []
    finally:
        hub.close()
        backend.stop()
        fakes.stop()


def test_backend_restart_continues_same_meeting(monkeypatch: Any, tmp_path: Path) -> None:
    """Gate 7.2: kill + restart the backend -> the persisted token reconnects
    with no re-pair and the meeting continues under the same meetingid."""
    fakes_port = free_port()
    fakes, _ = serve_fakes(fakes_port, [
        AsrTurn(stream="tab", speaker="A", text="restart flow one", lang="en",
                ts_start_ms=100, ts_end_ms=900),
        AsrTurn(stream="tab", speaker="A", text="restart flow two", lang="en",
                ts_start_ms=5000, ts_end_ms=5900),
    ], [])
    data_dir = tmp_path / "data"
    backend, code = serve_backend(monkeypatch, data_dir, fakes_port)
    port = backend.port
    hub = HubSocket(port)
    try:
        token = redeem(port, code)
        hub.connect(token)
        t0 = int(time.time() * 1000)
        hub.send(started_env("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", t0))
        hub.send(tiles_env("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"))
        hub.send_audio(0, t0, 15)
        before = wait_for(
            lambda: events_of(data_dir, "transcript.final"), 20, "pre-restart final")
        assert len(before) == 1
        hub.close()
        backend.stop()
        backend2, _unused_code = serve_backend(monkeypatch, data_dir, fakes_port, port=port)
        backend = backend2
        hub.connect(token)  # no re-pair: the persisted token must be accepted
        hub.send(active_env("dddddddd-dddd-4ddd-8ddd-dddddddddddd", t0 + 2000))
        hub.send(context_env("cccccccc-cccc-4ccc-8ccc-cccccccccccc"))
        acks, _ = hub.pump(10)
        assert acks["dddddddd-dddd-4ddd-8ddd-dddddddddddd"]["status"] == "ok"
        assert acks["cccccccc-cccc-4ccc-8ccc-cccccccccccc"]["status"] == "ok"
        stored = read_stored(data_dir)
        assert sum(1 for e in stored if e["type"] == "meeting.started") == 1
        assert [e for e in stored if e["type"] == "meeting.ended"] == []
        for e in stored:
            if e["type"] in ("meeting.started", "tiles.snapshot", "meeting.context",
                             "speaker.active", "transcript.final"):
                assert e["meetingid"] == MEETING
    finally:
        hub.close()
        backend.stop()
        fakes.stop()


def test_llm_failover_keeps_points_flowing(monkeypatch: Any, tmp_path: Path) -> None:
    """Gate 7.3: primary 5xx -> contributor answers, points flow with the
    failover engine, llm.health shows failover, primary retried post-cooldown."""
    turn1 = "Launch moves to Nov 12 if payments QA clears"
    turn2 = "Beta cohort grows to twenty percent on Friday"
    fakes_port = free_port()
    fakes, errors = serve_fakes(
        fakes_port,
        [AsrTurn(stream="tab", speaker="A", text=turn1, lang="en",
                 ts_start_ms=1000, ts_end_ms=1900),
         AsrTurn(stream="tab", speaker="A", text=turn2, lang="en",
                 ts_start_ms=3000, ts_end_ms=3900)],
        classifier_replies(2) + [
            LlmReply(match="Launch moves", response={
                "kind": "decision", "text": "Launch moves to Nov 12",
                "quote": turn1, "rank": 1, "urgency": "medium", "is_action": False}),
            LlmReply(match="Beta cohort", response={
                "kind": "point", "text": "Beta cohort grows",
                "quote": turn2, "rank": 1, "urgency": "medium", "is_action": False}),
        ],
        llm_errors={PRIMARY_MODEL: 500})
    data_dir = tmp_path / "data"
    backend, code = serve_backend(monkeypatch, data_dir, fakes_port)
    hub = HubSocket(backend.port)
    try:
        hub.connect(redeem(backend.port, code))
        t0 = int(time.time() * 1000)
        hub.send(started_env("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", t0))
        hub.send(tiles_env("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"))
        hub.send(context_env("cccccccc-cccc-4ccc-8ccc-cccccccccccc"))
        hub.send(active_env("dddddddd-dddd-4ddd-8ddd-dddddddddddd", t0 + 900))
        hub.send_audio(0, t0, 25)
        # (second batch below continues the stream sequence at 25)
        point = wait_for(
            lambda: [e for e in events_of(data_dir, "points.upsert")
                     if e["data"].get("text") == "Launch moves to Nov 12"],
            30, "first point")
        assert point[0]["data"]["engine"] == "muse-spark-1.3-contributor"
        status = wait_for(
            lambda: [e for e in events_of(data_dir, "system.status")
                     if e["data"].get("llm", {}).get("failover") is True],
            30, "failover health")
        assert status[0]["data"]["llm"]["engine"] == "muse-spark-1.3-contributor"
        del errors[PRIMARY_MODEL]  # primary healthy again; cooldown still running
        time.sleep(31)  # the 30 s cooldown, literally
        hub.send_audio(0, t0 + 2500, 15, start_seq=25)
        recovered = wait_for(
            lambda: [e for e in events_of(data_dir, "points.upsert")
                     if e["data"].get("text") == "Beta cohort grows"],
            30, "recovered point")
        assert recovered[0]["data"]["engine"] == "spark-open"
    finally:
        hub.close()
        backend.stop()
        fakes.stop()


def test_voice_drop_turn_survives_without_dup() -> None:
    """Gate 7.4: control.drop mid-turn -> the in-flight turn still completes
    on reconnect, exactly once, with no turnId reuse."""
    port = free_port()
    turns = [
        AsrTurn(stream="tab", speaker="A", text="first flow words", lang="en",
                ts_start_ms=0, ts_end_ms=2000),
        AsrTurn(stream="tab", speaker="A", text="second flow words", lang="en",
                ts_start_ms=3000, ts_end_ms=4000),
    ]
    served = ServedApp(lambda: create_asr_app(list(turns)), port)
    served.start()
    try:
        turns = asyncio.run(_drop_and_resume(port))
    finally:
        served.stop()
    assert [t["text"] for t in turns] == ["first flow words", "second flow words"]
    assert turns[0]["turn_id"] != turns[1]["turn_id"]


async def _drop_and_resume(port: int) -> list[dict]:
    assembler = TurnAssembler()
    events: list[dict] = []

    async def read(ws: Any, n: int, timeout: float = 15) -> None:
        for _ in range(n):
            events.append(json.loads(await asyncio.wait_for(ws.recv(), timeout)))

    async def collect(ws: Any, want: int, timeout: float = 15) -> None:
        while len([e for e in events if e.get("type") == "speechComplete"]) < want:
            msg = await asyncio.wait_for(ws.recv(), timeout)
            events.append(json.loads(msg))

    ws = await websockets.connect(f"ws://127.0.0.1:{port}/v1/asr/realtime")
    try:
        await ws.send(json.dumps(build_handshake(DIARIZATION, "gate7-dummy")))
        for _ in range(8):
            await ws.send(b"\x00\x00" * 1600)  # horizon 800: first turn open
        await read(ws, 2)  # speechStart + transcript
        assert [e["type"] for e in events] == ["speechStart", "transcript"]
        await ws.send("control.drop")
        try:
            await ws.recv()
            raise AssertionError("server did not close the dropped session")
        except ConnectionClosed:
            pass
    finally:
        await ws.close()
    ws = await websockets.connect(f"ws://127.0.0.1:{port}/v1/asr/realtime")
    try:
        await ws.send(json.dumps(build_handshake(DIARIZATION, "gate7-dummy")))
        for _ in range(37):
            await ws.send(b"\x00\x00" * 1600)  # horizon 4500: both turns due
        await collect(ws, 2)
    finally:
        await ws.close()
    turns = []
    for event in events:
        completed = assembler.handle(event)
        if completed is not None:
            turns.append(completed)
    return turns
