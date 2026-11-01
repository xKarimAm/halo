"""`system.status` + `meeting.ended` timeout tests (PLAN cases 6-7).

Status is built from `bus.health()`, published on the bus (so the Event
Store tap sees it) and broadcast to paired sockets, every 5 s and on change.
The 60 s dead-socket timer emits exactly one `reason: timeout` envelope per
meeting; a hub `meeting.ended` first cancels it. Short injected timeouts
stand in for the 60 s budget.
"""

from __future__ import annotations

import asyncio

from halo.bus import Bus
from halo.gateway.gateway import Gateway
from halo.gateway.session import SocketSession

from contracts.validate import validate_envelope

MEETING = "22222222-2222-4222-8222-222222222222"


def started_envelope() -> dict:
    return {
        "specversion": "1.0",
        "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "type": "meeting.started",
        "source": "halo/test",
        "time": "2026-10-31T09:00:00Z",
        "meetingid": MEETING,
        "datacontenttype": "application/json",
        "data": {
            "meeting_id": MEETING,
            "platform": "meet",
            "meeting_code": "abc-defg-hij",
            "t0_ms": 1,
            "self_name": "Karim",
        },
    }


def ended_envelope(reason: str) -> dict:
    return {
        "specversion": "1.0",
        "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "type": "meeting.ended",
        "source": "halo/test",
        "time": "2026-10-31T09:00:00Z",
        "meetingid": MEETING,
        "datacontenttype": "application/json",
        "data": {"reason": reason},
    }


def test_status_built_broadcast_and_published(tmp_path):
    async def run():
        gateway = Gateway(Bus(), data_dir=tmp_path, extension_id="x")
        gateway.bus.register_health("asr", lambda: "ok")
        gateway.bus.register_health("llm", lambda: {"engine": "spark-open", "failover": False})
        gateway.bus.register_health("tagger", lambda: "ok")
        seen: list = []
        gateway.bus.subscribe("system.status", seen.append)

        session = SocketSession(gateway)
        out: list = []

        async def sender(envelope: dict) -> None:
            out.append(envelope)

        gateway.attach(session, sender)
        session.paired = True  # broadcasts reach paired sockets only
        assert await gateway.tick_status() is True
        assert await gateway.tick_status() is False  # unchanged: silent
        assert len(seen) == 1 and len(out) == 1
        assert validate_envelope(seen[0]) == []
        assert seen[0]["data"] == {
            "asr": "ok",
            "llm": {"engine": "spark-open", "failover": False},
            "tagger": "ok",
        }

    asyncio.run(run())


def test_status_defaults_for_missing_services(tmp_path):
    async def run():
        gateway = Gateway(Bus(), data_dir=tmp_path, extension_id="x")
        assert gateway.build_status() == {
            "asr": "down",
            "llm": {"engine": "unknown", "failover": False},
            "tagger": "down",
        }
        assert await gateway.tick_status(force=True) is True

    asyncio.run(run())


def test_forwarded_bus_types_reach_paired_sockets(tmp_path):
    async def run():
        gateway = Gateway(Bus(), data_dir=tmp_path, extension_id="x")
        session = SocketSession(gateway)
        out: list = []

        async def sender(envelope: dict) -> None:
            out.append(envelope)

        gateway.attach(session, sender)
        session.paired = True
        point = {
            "specversion": "1.0",
            "id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            "type": "points.upsert",
            "source": "halo/test",
            "time": "2026-10-31T09:00:00Z",
            "meetingid": MEETING,
            "datacontenttype": "application/json",
            "data": {
                "point_id": "00000040-0000-4000-8000-000000000040",
                "tile_id": "t1",
                "speaker_name": "Layla",
                "kind": "point",
                "text": "x",
                "lang": "en",
                "quote": "x",
                "turn_ids": ["00000030-0000-4000-8000-000000000030"],
                "rank": 1,
                "attribution": "locked",
                "is_action": False,
                "engine": "spark-open",
            },
        }
        ack = await gateway.bus.publish(point)
        assert ack["status"] == "ok"
        assert out == [point]

    asyncio.run(run())


def test_dead_socket_emits_exactly_one_timeout(tmp_path):
    async def run():
        bus = Bus()
        gateway = Gateway(bus, data_dir=tmp_path, extension_id="x", timeout_s=0.05)
        ended: list = []
        bus.subscribe("meeting.ended", ended.append)
        assert (await bus.publish(started_envelope()))["status"] == "ok"

        session = SocketSession(gateway)

        async def sender(envelope: dict) -> None:
            pass

        gateway.attach(session, sender)
        gateway.detach(session)  # last socket drops: the 60 s watch starts
        await asyncio.sleep(0.2)
        timeouts = [e for e in ended if e["data"].get("reason") == "timeout"]
        assert len(timeouts) == 1
        assert timeouts[0]["meetingid"] == MEETING
        assert validate_envelope(timeouts[0]) == []
        await asyncio.sleep(0.15)
        assert len([e for e in ended if e["data"].get("reason") == "timeout"]) == 1
        gateway.stop()

    asyncio.run(run())


def test_hub_ended_first_cancels_the_timeout(tmp_path):
    async def run():
        bus = Bus()
        gateway = Gateway(bus, data_dir=tmp_path, extension_id="x", timeout_s=0.05)
        ended: list = []
        bus.subscribe("meeting.ended", ended.append)
        await bus.publish(started_envelope())

        session = SocketSession(gateway)

        async def sender(envelope: dict) -> None:
            pass

        gateway.attach(session, sender)
        gateway.detach(session)
        await bus.publish(ended_envelope("left"))  # hub wins the race
        await asyncio.sleep(0.2)
        assert [e["data"].get("reason") for e in ended] == ["left"]
        gateway.stop()

    asyncio.run(run())


def test_health_counts_open_meetings(tmp_path):
    async def run():
        bus = Bus()
        gateway = Gateway(bus, data_dir=tmp_path, extension_id="x")
        assert gateway.health()["meetings_open"] == 0
        await bus.publish(started_envelope())
        assert gateway.health()["meetings_open"] == 1
        await bus.publish(ended_envelope("left"))
        assert gateway.health()["meetings_open"] == 0
        gateway.stop()

    asyncio.run(run())
