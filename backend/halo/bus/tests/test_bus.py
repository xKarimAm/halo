import asyncio

from halo.bus import Bus

MEETING = "22222222-2222-4222-8222-222222222222"
BASE = {
    "specversion": "1.0",
    "id": "11111111-1111-4111-8111-111111111111",
    "source": "halo/test",
    "time": "2026-10-31T09:00:00Z",
    "datacontenttype": "application/json",
    "meetingid": MEETING,
}


def env(type_, data):
    return {**BASE, "type": type_, "data": data}


def test_publish_valid_delivers_only_to_matching_type_and_taps_once():
    async def run():
        bus = Bus()
        seen, other, tapped = [], [], []
        bus.subscribe("llm.health", lambda e: seen.append(e))
        bus.subscribe("points.upsert", lambda e: other.append(e))
        bus.set_tap(lambda e: tapped.append(e))
        ack = await bus.publish(env("llm.health", {"engine": "spark-open", "p90_ms": 10}))
        assert ack["status"] == "ok"
        assert len(seen) == 1 and other == [] and len(tapped) == 1

    asyncio.run(run())


def test_publish_invalid_and_unknown_return_typed_ack_and_deliver_nothing():
    async def run():
        bus = Bus()
        seen, tapped = [], []
        bus.subscribe("points.upsert", lambda e: seen.append(e))
        bus.set_tap(lambda e: tapped.append(e))
        ack = await bus.publish(env("points.upsert", {"point_id": "x"}))
        assert ack["status"] == "error" and ack["error"]["code"] == "invalid_schema"
        ack2 = await bus.publish(env("nope.type", {}))
        assert ack2["status"] == "error" and ack2["error"]["code"] == "unknown_type"
        assert seen == [] and tapped == []

    asyncio.run(run())


def test_health_and_throwing_subscriber_is_isolated():
    async def run():
        bus = Bus()
        bus.register_health("asr", lambda: "ok")

        def down():
            raise RuntimeError("down")

        bus.register_health("llm", down)
        assert bus.health()["asr"] == "ok"
        assert bus.health()["llm"] != "ok"

        def boom(_e):
            raise RuntimeError("bad consumer")

        got = []
        bus.subscribe("llm.health", boom)
        bus.subscribe("llm.health", lambda e: got.append(e))
        ack = await bus.publish(env("llm.health", {"engine": "spark-open", "p90_ms": 1}))
        assert ack["status"] == "ok" and len(got) == 1

    asyncio.run(run())
