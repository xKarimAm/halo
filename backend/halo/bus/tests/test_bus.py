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


def test_tap_sees_every_accepted_envelope_exactly_once():
    async def run():
        bus = Bus()
        tapped = []
        bus.set_tap(lambda e: tapped.append(e["id"]))

        first = {**env("llm.health", {"engine": "spark-open", "p90_ms": 10}),
                 "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}
        second = {**env("llm.health", {"engine": "muse-spark-1.3-contributor", "p90_ms": 20}),
                  "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}
        assert (await bus.publish(first))["status"] == "ok"
        assert (await bus.publish(second))["status"] == "ok"
        # Rejected envelopes never reach the tap.
        bad = await bus.publish(env("points.upsert", {"point_id": "x"}))
        assert bad["error"]["code"] == "invalid_schema"
        assert tapped == [first["id"], second["id"]]

    asyncio.run(run())


def test_subscribers_run_in_order_with_no_retry():
    async def run():
        bus = Bus()
        order, boom_calls = [], []

        def boom(_e):
            boom_calls.append(1)
            raise RuntimeError("bad consumer")

        async def second(e):
            order.append(("second", e["id"]))

        bus.subscribe("llm.health", lambda e: order.append(("first", e["id"])))
        bus.subscribe("llm.health", boom)
        bus.subscribe("llm.health", second)
        envelope = {**env("llm.health", {"engine": "spark-open", "p90_ms": 1}),
                    "id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc"}
        ack = await bus.publish(envelope)
        assert ack == {"ack_of": envelope["id"], "status": "ok"}
        assert order == [("first", envelope["id"]), ("second", envelope["id"])]
        assert len(boom_calls) == 1

    asyncio.run(run())
