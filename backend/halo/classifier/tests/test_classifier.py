"""Classifier tests: every PLAN case against a scripted model fake.

A fresh point has no tag rows, so both fields are missing and exactly one
call fills them; present fields (user or model) suppress without calls.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from halo.bus import Bus
from halo.classifier import Classifier

from contracts.validate import validate_envelope

MEETING = "22222222-2222-4222-8222-222222222222"
POINT = "00000040-0000-4000-8000-000000000040"


class FakeLLM:
    def __init__(self, replies: list) -> None:
        self._replies = list(replies)
        self.calls: list[str] = []

    def complete_json(self, *, prompt, schema, schema_name="classifier.tags",
                      system=None, prompt_cache_key=None):
        self.calls.append(prompt)
        reply = self._replies.pop(0) if self._replies else {
            "data": {"kind": "decision", "urgency": "medium"}}
        if reply.get("fail"):
            return SimpleNamespace(ok=False, engine="spark-open", data=None,
                                   error={"code": "engine_error", "message": "down"})
        return SimpleNamespace(ok=True, engine=reply.get("engine", "spark-open"),
                               data=reply["data"], error=None)

    def health(self):
        return {"engine": "spark-open", "failover": False}


def point_envelope(point_id=POINT, **over):
    data = {
        "point_id": point_id, "tile_id": "t1", "speaker_name": "Layla",
        "kind": "decision", "text": "Launch moves to Nov 12", "lang": "en",
        "quote": "Launch moves.", "turn_ids": ["00000030-0000-4000-8000-000000000030"],
        "rank": 1, "attribution": "locked", "urgency": "medium",
        "is_action": False, "engine": "spark-open",
    }
    data.update(over)
    return {
        "specversion": "1.0", "id": point_id, "type": "points.upsert",
        "source": "halo/test", "time": "2026-10-31T09:00:00Z",
        "meetingid": MEETING, "datacontenttype": "application/json", "data": data,
    }


def tags_envelope(target_id, source, kind=None, urgency=None, target="point"):
    data = {"target": target, "target_id": target_id, "source": source}
    if kind is not None:
        data["kind"] = kind
    if urgency is not None:
        data["urgency"] = urgency
    if source == "model":
        data["model"] = "spark-open"
    return {
        "specversion": "1.0", "id": target_id, "type": "tags.set",
        "source": "halo/test", "time": "2026-10-31T09:00:00Z",
        "meetingid": MEETING, "datacontenttype": "application/json", "data": data,
    }


def setup(replies):
    bus = Bus()
    llm = FakeLLM(replies)
    classifier = Classifier(bus, llm)
    published: list = []
    bus.subscribe("tags.set", lambda e: published.append(e)
                  if e.get("source") == "halo/classifier" else None)
    return bus, llm, classifier, published


def test_present_tags_make_no_calls():
    async def run():
        bus, llm, classifier, published = setup([])
        await bus.publish(tags_envelope(POINT, "user", kind="decision", urgency="urgent"))
        await bus.publish(point_envelope())
        await classifier.flush()
        assert llm.calls == [] and published == []
        # Same when the present rows are the model's own earlier answer.
        await bus.publish(tags_envelope(POINT, "model", kind="decision", urgency="medium"))
        await bus.publish(point_envelope())
        await classifier.flush()
        assert llm.calls == [] and published == []

    asyncio.run(run())


def test_missing_kind_classified_once():
    async def run():
        bus, llm, classifier, published = setup(
            [{"data": {"kind": "decision", "urgency": "later"}}])
        await bus.publish(point_envelope())
        await classifier.flush()
        assert len(llm.calls) == 1
        assert len(published) == 1
        data = published[0]["data"]
        assert validate_envelope(published[0]) == []
        assert (data["target"], data["target_id"]) == ("point", POINT)
        assert data["kind"] == "decision" and data["urgency"] == "later"
        assert data["source"] == "model" and data["model"] == "spark-open"

    asyncio.run(run())


def test_user_tagged_field_skipped_same_tick():
    async def run():
        bus, llm, classifier, published = setup(
            [{"data": {"kind": "question", "urgency": "urgent"}}])
        await bus.publish(tags_envelope(POINT, "user", kind="decision"))
        await bus.publish(point_envelope())
        await classifier.flush()
        assert len(llm.calls) == 1
        data = published[0]["data"]
        assert "kind" not in data  # user-tagged: never overridden
        assert data["urgency"] == "urgent"
        assert "Launch moves to Nov 12" in llm.calls[0]  # decision text in entry
        assert "kind=decision" in llm.calls[0]  # current user tags first

    asyncio.run(run())


def test_double_upsert_same_tick_one_call():
    async def run():
        bus, llm, classifier, published = setup(
            [{"data": {"kind": "decision", "urgency": "medium"}}])
        await bus.publish(point_envelope())
        await bus.publish(point_envelope())
        await classifier.flush()
        assert len(llm.calls) == 1 and len(published) == 1

    asyncio.run(run())


def test_health_down_after_repeated_failure():
    async def run():
        # 1 + 2 + 3 calls across the three flushes; every one fails.
        bus, _llm, classifier, published = setup([{"fail": True}] * 6)
        assert classifier.health() == "ok"
        for i in range(3):
            pid = f"1000000{i}-0000-4000-8000-00000000000{i}"
            await bus.publish(point_envelope(point_id=pid))
            await classifier.flush()
        assert published == [] and classifier.health() == "down"

    asyncio.run(run())


def test_success_resets_health():
    async def run():
        bus, _llm, classifier, published = setup(
            [{"fail": True}] * 3
            + [{"data": {"kind": "point", "urgency": "later"}}] * 3)
        for i in range(3):
            pid = f"1000000{i}-0000-4000-8000-00000000000{i}"
            await bus.publish(point_envelope(point_id=pid))
            await classifier.flush()
            if i == 1:
                assert classifier.health() == "down"
        assert classifier.health() == "ok" and len(published) == 3

    asyncio.run(run())
