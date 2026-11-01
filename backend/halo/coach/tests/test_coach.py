"""Coach tests: a scripted model fake; tick() stands in for the 60 s loop."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from halo.bus import Bus
from halo.coach import Coach

from contracts.validate import validate_envelope

MEETING = "22222222-2222-4222-8222-222222222222"


class FakeLLM:
    def __init__(self, replies: list) -> None:
        self.replies = list(replies)
        self.prompts: list[str] = []

    def complete_json(self, *, prompt, schema, schema_name="", system=None, prompt_cache_key=None):
        self.prompts.append(prompt)
        data = self.replies.pop(0)
        if data is None:
            return SimpleNamespace(ok=False, engine="x", data=None, error={"code": "engine_error"})
        return SimpleNamespace(ok=True, engine="x", data=data, error=None)


def env(type_, data, n=1):
    return {"specversion": "1.0", "id": f"00000000-0000-4000-8000-{n:012d}", "type": type_,
            "source": "halo/test", "time": "2026-11-02T09:00:00Z", "meetingid": MEETING,
            "datacontenttype": "application/json", "data": data}


def turn(text, name="Layla", n=1):
    return env("turn.attributed", {
        "turn_id": f"00000000-0000-4000-8000-{n:012d}", "text": text, "lang": "en",
        "ts_start_ms": 1000, "ts_end_ms": 2000, "tile_id": "t1", "name": name,
        "attribution": "provisional", "overlap": False}, n)


def setup(replies):
    bus = Bus()
    llm = FakeLLM(replies)
    coach = Coach(bus, llm, min_new_words=5)
    tips: list = []
    bus.subscribe("coach.tips", tips.append)
    return bus, llm, coach, tips


def test_tips_come_from_the_whole_meeting_in_the_viewer_language():
    async def run():
        bus, llm, coach, tips = setup([{"tips": ["Ask Omar for a date."]}])
        await bus.publish(env("meeting.context", {"subject": "Launch", "agenda": [], "roles": [],
                                                  "viewer_lang": "ar"}, 90))
        await bus.publish(turn("We move the launch to the twelfth", n=2))
        await bus.publish(turn("Fine but who tells the client", name="Omar", n=3))
        await coach.tick()
        assert len(tips) == 1 and validate_envelope(tips[0]) == []
        assert tips[0]["data"] == {"tips": ["Ask Omar for a date."], "lang": "ar"}
        assert "Layla: We move the launch" in llm.prompts[0] and "Omar: Fine" in llm.prompts[0]

    asyncio.run(run())


def test_a_quiet_minute_makes_no_call_and_old_tips_feed_the_next():
    async def run():
        bus, llm, coach, tips = setup([{"tips": ["One."]}, {"tips": ["Two."]}])
        await bus.publish(turn("one two three four five six", n=2))
        await coach.tick()
        await coach.tick()  # no new words
        assert len(llm.prompts) == 1
        await bus.publish(turn("seven eight nine ten eleven", n=3))
        await coach.tick()
        assert len(tips) == 2 and "Previous tips: One." in llm.prompts[1]

    asyncio.run(run())


def test_a_failed_call_retries_next_tick_and_an_ended_meeting_stops():
    async def run():
        bus, llm, coach, tips = setup([None, {"tips": ["Back."]}])
        await bus.publish(turn("one two three four five six", n=2))
        await coach.tick()
        assert tips == []
        await coach.tick()
        assert len(tips) == 1
        await bus.publish(turn("one two three four five six", n=3))
        await bus.publish(env("meeting.ended", {"reason": "left"}, 91))
        await coach.tick()
        assert len(llm.prompts) == 2

    asyncio.run(run())


def test_the_prompt_keeps_the_newest_words_under_the_cap():
    bus = Bus()
    coach = Coach(bus, FakeLLM([]), max_words=6)

    async def run():
        await bus.publish(turn("old old old old", n=2))
        await bus.publish(turn("new new new new", n=3))

    asyncio.run(run())
    prompt = coach.build_prompt(MEETING)
    assert "new new" in prompt and "old old" not in prompt
