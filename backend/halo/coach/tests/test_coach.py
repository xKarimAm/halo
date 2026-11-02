"""Coach tests: a scripted model fake and a fake clock; tick() stands in for the 1 s loop."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from halo.bus import Bus
from halo.coach import Coach
from halo.coach.coach import MIN_GAP_S, SILENCE_S

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


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def setup(replies):
    bus = Bus()
    llm = FakeLLM(replies)
    clock = Clock()
    coach = Coach(bus, llm, clock=clock)
    tips: list = []
    bus.subscribe("coach.tips", tips.append)
    return bus, llm, coach, tips, clock


def test_tips_speak_to_the_viewer_in_their_role_and_language():
    async def run():
        bus, llm, coach, tips, _clock = setup([{"tips": ["Ask Omar for a date."], "alert": ""}])
        await bus.publish(env("meeting.started", {
            "meeting_id": MEETING, "platform": "meet", "meeting_code": "abc-defg-hij",
            "t0_ms": 0, "self_name": "Layla"}, 89))
        await bus.publish(env("meeting.context", {
            "subject": "Launch", "agenda": [], "viewer_lang": "ar",
            "roles": [{"name": "Layla", "role": "Technical product manager"}]}, 90))
        await bus.publish(turn("We move the launch to the twelfth", n=2))
        await bus.publish(turn("Fine but who tells the client", name="Omar", n=3))
        await coach.tick()
        assert len(tips) == 1 and validate_envelope(tips[0]) == []
        assert tips[0]["data"] == {"tips": ["Ask Omar for a date."], "lang": "ar"}
        prompt = llm.prompts[0]
        assert "Viewer: Layla, Technical product manager" in prompt
        assert "Layla (you): We move the launch" in prompt and "Omar: Fine" in prompt

    asyncio.run(run())


def test_new_words_call_within_seconds_but_at_most_once_per_gap():
    async def run():
        bus, llm, coach, tips, clock = setup([{"tips": ["One."], "alert": ""},
                                              {"tips": ["Two."], "alert": ""}])
        await bus.publish(turn("one two three", n=2))
        await coach.tick()
        assert len(llm.prompts) == 1  # first words: at once
        await bus.publish(turn("four five", n=3))
        clock.now += MIN_GAP_S - 1
        await coach.tick()
        assert len(llm.prompts) == 1  # inside the gap: waits
        clock.now += 1
        await coach.tick()
        assert len(tips) == 2 and "Previous tips: One." in llm.prompts[1]
        await coach.tick()
        assert len(llm.prompts) == 2  # nothing new: no call

    asyncio.run(run())


def test_a_long_silence_calls_once_until_someone_speaks():
    async def run():
        bus, llm, coach, _tips, clock = setup([{"tips": ["One."], "alert": ""},
                                              {"tips": ["Ask Omar by name."], "alert": ""}])
        await bus.publish(turn("What is the budget?", n=2))
        await coach.tick()
        clock.now += SILENCE_S
        await coach.tick()
        assert "Why now: 15 s of silence" in llm.prompts[1]
        clock.now += 60
        await coach.tick()
        assert len(llm.prompts) == 2  # one call per quiet stretch

    asyncio.run(run())


def test_an_alert_keeps_the_tips_and_an_empty_reply_publishes_nothing():
    async def run():
        bus, _llm, coach, tips, clock = setup([
            {"tips": ["Ask Omar for a date."], "alert": ""},
            {"tips": [], "alert": "Remove the personal remark."},
            {"tips": [], "alert": ""}])
        for n, text in enumerate(["Dates first", "You never listen, typical", "Okay"], start=2):
            await bus.publish(turn(text, n=n))
            await coach.tick()
            clock.now += MIN_GAP_S
        assert [t["data"] for t in tips] == [
            {"tips": ["Ask Omar for a date."], "lang": "en"},
            {"tips": ["Ask Omar for a date."], "alert": "Remove the personal remark.", "lang": "en"}]
        assert all(validate_envelope(t) == [] for t in tips)

    asyncio.run(run())


def test_a_failed_call_retries_next_tick_and_an_ended_meeting_stops():
    async def run():
        bus, llm, coach, tips, clock = setup([None, {"tips": ["Back."], "alert": ""}])
        await bus.publish(turn("one two three four five six", n=2))
        await coach.tick()
        assert tips == []
        clock.now += MIN_GAP_S
        await coach.tick()
        assert len(tips) == 1
        await bus.publish(turn("one two three four five six", n=3))
        await bus.publish(env("meeting.ended", {"reason": "left"}, 91))
        clock.now += MIN_GAP_S
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
