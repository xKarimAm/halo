"""Coach tests: a scripted model fake and a fake clock; tick() stands in for the 1 s loop."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from halo.bus import Bus
from halo.coach import Coach
from halo.coach.coach import COACH_EFFORT, COACH_TIMEOUT_S, MIN_GAP_S, SILENCE_S, WARMUP_S

from contracts.validate import validate_envelope

MEETING = "22222222-2222-4222-8222-222222222222"


class FakeLLM:
    def __init__(self, replies: list) -> None:
        self.replies = list(replies)
        self.prompts: list[str] = []

    def complete_json(self, *, prompt, schema, schema_name="", system=None, prompt_cache_key=None, timeout_s=None,
                      effort=None):
        self.efforts = [*getattr(self, "efforts", []), effort]
        self.prompts.append(prompt)
        self.timeouts = [*getattr(self, "timeouts", []), timeout_s]
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
    coach = Coach(bus, llm, clock=clock, warmup_s=0.0)
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
        assert len(tips) == 2 and "Tips shown earlier: One." in llm.prompts[1]
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
        assert len(llm.prompts) == 1  # a silence waits out the gap too (Karim 2026-11-16: think, not speed)
        clock.now += MIN_GAP_S - SILENCE_S
        await coach.tick()
        assert f"Why now: {MIN_GAP_S:.0f} s of silence" in llm.prompts[1]
        clock.now += 60
        await coach.tick()
        assert len(llm.prompts) == 2  # one call per quiet stretch

    asyncio.run(run())


def test_an_alert_keeps_the_tips_and_an_empty_reply_publishes_nothing():
    async def run():
        bus, _llm, coach, tips, clock = setup([
            {"tips": ["Ask Omar for a date."], "alert": ""},
            {"tips": [], "alert": "Remove the personal remark.", "alert_quote": "You never listen"},
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


def test_the_self_tile_names_the_viewer_when_meeting_started_had_none():
    async def run():
        bus, llm, coach, _tips, _clock = setup([{"tips": ["One."], "alert": ""}])
        await bus.publish(env("meeting.started", {
            "meeting_id": MEETING, "platform": "meet", "meeting_code": "abc-defg-hij",
            "t0_ms": 0, "self_name": ""}, 89))
        await bus.publish(env("tiles.snapshot", {"tiles": [
            {"tile_id": "t2", "name": "Omar", "is_self": False, "rect": [0, 0, 10, 10],
             "video_w": 640, "video_h": 360, "fit": "cover", "captions_rect": None},
            {"tile_id": "t1", "name": "Layla", "is_self": True, "rect": [0, 0, 10, 10],
             "video_w": 640, "video_h": 360, "fit": "cover", "captions_rect": None}]}, 88))
        await bus.publish(turn("We move the launch", n=2))
        await coach.tick()
        assert "Viewer: Layla" in llm.prompts[0] and "Layla (you): We move" in llm.prompts[0]

    asyncio.run(run())


def test_alone_in_the_call_a_talk_over_alert_is_dropped():
    # Live 2026-11-02: alone, naming Sarah and John, the viewer got "Let them finish."
    async def run():
        bus, _llm, coach, tips, clock = setup([
            {"tips": [], "alert": "Pause and invite others in."},
            {"tips": [], "alert": "Park it: owner and date.", "alert_quote": "take the dates again"}])
        await bus.publish(env("tiles.snapshot", {"tiles": [
            {"tile_id": "t1", "name": "Layla", "is_self": True, "rect": [0, 0, 10, 10],
             "video_w": 640, "video_h": 360, "fit": "cover", "captions_rect": None}]}, 88))
        await bus.publish(turn("Sarah please take the dates, John the testing", name="Layla", n=2))
        await coach.tick()
        assert tips == []  # nobody to talk over
        clock.now += 100
        await bus.publish(turn("Sarah please take the dates again", name="Layla", n=3))
        await coach.tick()
        assert tips[0]["data"]["alert"] == "Park it: owner and date."

    asyncio.run(run())


def test_the_same_alert_never_shows_twice_and_alone_means_rehearsal():
    # Night eval 2026-11-03: "Park it: owner and date." fired loop after loop,
    # and alone in the call the coach said "Ask Sara".
    async def run():
        bus, llm, coach, tips, clock = setup([
            {"tips": ["One."], "alert": "Park it: owner and date.", "alert_quote": "take the dates"},
            {"tips": ["Two."], "alert": "Park it: owner and date.", "alert_quote": "take the dates"}])
        await bus.publish(env("tiles.snapshot", {"tiles": [
            {"tile_id": "t1", "name": "Layla", "is_self": True, "rect": [0, 0, 10, 10],
             "video_w": 640, "video_h": 360, "fit": "cover", "captions_rect": None}]}, 88))
        await bus.publish(turn("Sara will take the dates", name="Layla", n=2))
        await coach.tick()
        assert "rehearsing" in llm.prompts[0]
        clock.now += 100
        await bus.publish(turn("Sara will take the dates again", name="Layla", n=3))
        await coach.tick()
        assert tips[0]["data"].get("alert") == "Park it: owner and date."
        assert "alert" not in tips[1]["data"] and tips[1]["data"]["tips"] == ["Two."]

    asyncio.run(run())


def test_a_reworded_alert_of_the_same_kind_never_shows_twice():
    # Eval 2026-11-03: "Park it: Rami, Sophie, decide Friday." then "Park it Rami,
    # Sophie: owner and date." slipped past the exact-text dedupe.
    async def run():
        bus, _llm, coach, tips, clock = setup([
            {"tips": ["One."], "alert": "Park it: Rami, Sophie, decide Friday.", "alert_quote": "Rami says in place"},
            {"tips": ["Two."], "alert": "Park it Rami, Sophie: owner and date.", "alert_quote": "Sophie says replicate"}])
        await bus.publish(turn("Rami says in place", name="Rami", n=2))
        await coach.tick()
        clock.now += 100
        await bus.publish(turn("Sophie says replicate", name="Sophie", n=3))
        await coach.tick()
        assert tips[0]["data"]["alert"].startswith("Park it")
        assert "alert" not in tips[1]["data"]

    asyncio.run(run())


def test_a_late_turn_after_the_meeting_ended_calls_nothing():
    # Review 2026-11-03: a final turn flushed after meeting.ended revived the meeting.
    async def run():
        bus, llm, coach, tips, clock = setup([])
        await bus.publish(env("meeting.ended", {"reason": "left"}, 91))
        await bus.publish(turn("one last thing", n=2))
        clock.now += 100
        await coach.tick()
        assert llm.prompts == [] and tips == []

    asyncio.run(run())


def test_the_prompt_remembers_earlier_tips_not_only_the_last_set():
    # Live 2026-11-04: "Lead with tomorrow morning..." came back four times in
    # five minutes; only the latest set was in "Previous tips".
    async def run():
        bus, llm, coach, _tips, clock = setup([
            {"tips": ["Lead with the deadline."], "alert": ""},
            {"tips": ["Cut the filler."], "alert": ""},
            {"tips": [], "alert": ""}])
        for n, text in enumerate(["The demo is due tomorrow", "um so yeah basically", "and the pill"], start=2):
            await bus.publish(turn(text, n=n))
            await coach.tick()
            clock.now += 100
        assert "Lead with the deadline." in llm.prompts[2] and "Cut the filler." in llm.prompts[2]

    asyncio.run(run())


def test_an_alert_read_aloud_is_not_proof_of_a_new_one():
    # Live 2026-11-04: the viewer read "Lower your tone with Omar" aloud and got
    # "Karim, lower your tone." for their own reading.
    async def run():
        bus, _llm, coach, tips, clock = setup([
            {"tips": [], "alert": "Let Omar finish.", "alert_quote": "wait wait"},
            {"tips": [], "alert": "Lower your voice.", "alert_quote": "let omar finish it says"}])
        await bus.publish(turn("wait wait", name="Layla", n=2))
        await coach.tick()
        clock.now += 300
        await bus.publish(turn("let Omar finish, it says", name="Layla", n=3))
        await coach.tick()
        assert [t["data"].get("alert") for t in tips] == ["Let Omar finish."]

    asyncio.run(run())


def test_quote_rules_one_by_one():
    async def run():
        bus, _llm, coach, tips, clock = setup([
            {"tips": [], "alert": "Bring it back to dates.", "alert_quote": ""},
            {"tips": [], "alert": "Bring it back to dates.", "alert_quote": "words nobody said"},
            {"tips": [], "alert": "Alert: Bring it back to dates.", "alert_quote": "Your Team, always late!"}])
        await bus.publish(turn("your team always late again", name="Omar", n=2))
        seen = []
        for k in range(3):
            await coach.tick()
            seen.append(len(tips))
            clock.now += 300
            await bus.publish(turn("more", name="Omar", n=10 + k))
        assert seen == [0, 0, 1]  # no quote, invented quote: dropped; the real words (any case, punctuation) pass
        assert tips[0]["data"]["alert"] == "Bring it back to dates."

    asyncio.run(run())


def test_a_second_alert_waits_three_minutes():
    async def run():
        bus, _llm, coach, tips, clock = setup([
            {"tips": [], "alert": "Bring it back to dates.", "alert_quote": "always late"},
            {"tips": ["Name an owner."], "alert": "Let Omar finish.", "alert_quote": "wait wait"},
            {"tips": [], "alert": "Let Omar finish.", "alert_quote": "wait wait"}])
        await bus.publish(turn("your team is always late", name="Omar", n=2))
        await coach.tick()
        clock.now += 60
        await bus.publish(turn("wait wait", name="Layla", n=3))
        await coach.tick()
        clock.now += 200
        await bus.publish(turn("okay go on", name="Layla", n=4))
        await coach.tick()
        assert [t["data"].get("alert") for t in tips] == ["Bring it back to dates.", None, "Let Omar finish."]

    asyncio.run(run())


def test_a_coach_call_gets_more_time_than_a_live_point():
    # Live 2026-11-04: 14 coach calls timed out at Spark Open's 4 s live budget,
    # and each one pushed the live points onto the backup model for 30 s.
    async def run():
        bus, llm, coach, _tips, _clock = setup([{"tips": [], "alert": "", "alert_quote": ""}])
        await bus.publish(turn("the gateway is late again", n=2))
        await coach.tick()
        assert llm.timeouts == [COACH_TIMEOUT_S] and COACH_TIMEOUT_S >= 8

    asyncio.run(run())


def test_the_read_line_shows_what_is_going_on_and_updates_alone():
    # Karim 2026-11-16: "tell me what the introduction is and what is going on".
    async def run():
        bus, _llm, coach, tips, clock = setup([
            {"read": "Opening: mic checks, no topic yet.", "tips": ["Open with the goal."], "alert": "",
             "alert_quote": ""},
            {"read": "Opening: mic checks, no topic yet.", "tips": ["Open with the goal."], "alert": "",
             "alert_quote": ""},
            {"read": "Deciding the launch date; no owner yet.", "tips": ["Ask who owns it."], "alert": "",
             "alert_quote": ""},
            {"read": "Settled: launch on the 15th, Layla owns it.", "tips": [], "alert": "", "alert_quote": ""}])
        for n, text in enumerate(["Can you hear me?", "Hello hello", "We launch on the fifteenth.", "Layla owns it."],
                                 start=2):
            await bus.publish(turn(text, n=n))
            await coach.tick()
            clock.now += MIN_GAP_S
        # The second reply changes nothing on screen; empty tips with a new read clear the list
        # (blind eval 2026-11-16: carried-over tips contradicted an "all settled" read).
        assert [t["data"] for t in tips] == [
            {"read": "Opening: mic checks, no topic yet.", "tips": ["Open with the goal."], "lang": "en"},
            {"read": "Deciding the launch date; no owner yet.", "tips": ["Ask who owns it."], "lang": "en"},
            {"read": "Settled: launch on the 15th, Layla owns it.", "tips": [], "lang": "en"}]
        assert "Tips on screen now: Ask who owns it." in _llm.prompts[3]
        assert all(validate_envelope(t) == [] for t in tips)

    asyncio.run(run())


def test_the_prompt_carries_speech_numbers_for_the_viewer():
    async def run():
        bus, llm, coach, _tips, _clock = setup([{"read": "", "tips": [], "alert": "", "alert_quote": ""}])
        await bus.publish(env("meeting.started", {
            "meeting_id": MEETING, "platform": "meet", "meeting_code": "abc-defg-hij",
            "t0_ms": 0, "self_name": "Karim"}, 89))
        await bus.publish(env("turn.attributed", {
            "turn_id": "00000000-0000-4000-8000-000000000002", "text": "Um so basically we ship it, you know",
            "lang": "en", "ts_start_ms": 0, "ts_end_ms": 30000, "tile_id": "t0", "name": "Karim",
            "attribution": "provisional", "overlap": False}, 2))
        await bus.publish(env("turn.attributed", {
            "turn_id": "00000000-0000-4000-8000-000000000003", "text": "When?", "lang": "en",
            "ts_start_ms": 90000, "ts_end_ms": 91000, "tile_id": "t1", "name": "Layla",
            "attribution": "provisional", "overlap": False}, 3))
        await coach.tick()
        line = next(x for x in llm.prompts[0].splitlines() if x.startswith("Speech so far"))
        assert line == ("Speech so far: 2 min in; your longest unbroken stretch "
                        "8 words; questions you asked 0; filler words 3; your pace 16 words per minute.")

    asyncio.run(run())


def test_talk_share_shows_only_after_enough_words():
    _bus, _llm, coach, _tips, _clock = setup([])
    coach._self_names[MEETING] = "Karim"
    coach._turns[MEETING] = [("Karim", "word " * 60), ("Layla", "word " * 20)]
    assert "you said 75% of 80 words" in coach.speech(MEETING)
    coach._turns[MEETING] = [("Karim", "word " * 30)]
    assert "you said" not in coach.speech(MEETING)


def test_alone_there_is_no_unbroken_stretch():
    # Eval 2026-11-16 on Karim's rehearsal: alone, the stretch was every word he said,
    # read back as "you ran 93 words without a pause" over short choppy lines.
    _bus, _llm, coach, _tips, _clock = setup([])
    coach._self_names[MEETING] = "Karim"
    coach._turns[MEETING] = [("Karim", "Hello, hello?"), ("Karim", "this is the Halo demo")]
    assert "unbroken" not in coach.speech(MEETING)


def test_no_viewer_name_means_no_viewer_numbers_and_tidy_quotes():
    # Review 2026-11-16: zeros for an unknown viewer read as "you asked no questions".
    async def run():
        bus, _llm, coach, tips, _clock = setup([
            {"read": "Opening.", "tips": ["No goal yet: open with 'Today we decide.'."], "alert": "", "alert_quote": ""}])
        coach._turns[MEETING] = [("Layla", "Hello?")]
        assert coach.speech(MEETING) == "Speech so far: viewer not known yet, so no numbers on the viewer."
        await bus.publish(turn("Hello there", n=2))
        await coach.tick()
        assert tips[0]["data"]["tips"] == ["No goal yet: open with 'Today we decide.'"]

    asyncio.run(run())


def test_the_coach_listens_a_minute_before_its_first_tip_and_thinks_harder():
    # Karim 2026-11-16: "think for a while before it talks"; "Hello, hello?" got "no topic yet".
    async def run():
        bus = Bus()
        llm = FakeLLM([{"read": "Opening: Karim introduced the Halo demo.", "tips": [], "alert": "", "alert_quote": ""}])
        clock = Clock()
        coach = Coach(bus, llm, clock=clock)
        await bus.publish(turn("Hello, hello?", n=2))
        await coach.tick()
        clock.now += WARMUP_S - 1
        await bus.publish(turn("My name is Karim and this is the Halo demo.", n=3))
        await coach.tick()
        assert llm.prompts == []  # still inside the first minute
        clock.now += 1
        await coach.tick()
        assert len(llm.prompts) == 1 and "Halo demo" in llm.prompts[0]
        assert llm.efforts == [COACH_EFFORT] and MIN_GAP_S >= 30

    asyncio.run(run())
