"""Insight tests: every PLAN case against a scripted model fake.

The fake speaks the llm lane's result shape (`{ok, engine, data?, error?}`)
so no model import is needed here; the real client is injected by the
composition root. A fake clock drives the 3 s / 30 RPM / 30 s budgets with no
sleeping.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from halo.bus import Bus
from halo.insight import PROMPT_CACHE_KEY, Insight

from contracts.validate import validate_envelope

MEETING = "22222222-2222-4222-8222-222222222222"


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


class FakeLLM:
    """Scripted results; each may carry latency the fake clock advances."""

    def __init__(self, clock: Clock, replies: list) -> None:
        self._clock = clock
        self._replies = list(replies)
        self.calls: list[dict] = []
        self._engine = "spark-open"

    def complete_json(self, *, prompt, schema, schema_name="insight.point",
                      system=None, prompt_cache_key=None):
        self.calls.append({"prompt": prompt, "schema_name": schema_name,
                           "prompt_cache_key": prompt_cache_key})
        reply = self._replies.pop(0) if self._replies else point_reply("leftover")
        self._clock.advance(reply.get("latency_s", 0.05))
        if reply.get("fail"):
            return SimpleNamespace(ok=False, engine=self._engine,
                                   data=None, error={"code": "engine_error", "message": "down"})
        self._engine = reply.get("engine", "spark-open")
        return SimpleNamespace(ok=True, engine=self._engine, data=reply["data"], error=None)

    def health(self):
        return {"engine": self._engine, "failover": self._engine != "spark-open"}


def point_reply(text, **over):
    data = {"kind": "decision", "text": text, "quote": text + ".",
            "rank": 1, "urgency": "medium", "is_action": True}
    data.update(over)
    return {"data": data}


def turn_envelope(turn_id, text, name="Layla", tile="t1", attribution="provisional",
                  lang="en", ts=1000):
    return {
        "specversion": "1.0",
        "id": turn_id,
        "type": "turn.attributed",
        "source": "halo/test",
        "time": "2026-10-31T09:00:00Z",
        "meetingid": MEETING,
        "datacontenttype": "application/json",
        "data": {
            "turn_id": turn_id, "text": text, "lang": lang,
            "ts_start_ms": ts, "ts_end_ms": ts + 3000,
            "tile_id": tile, "name": name,
            "attribution": attribution, "overlap": False,
        },
    }


def context_envelope(viewer_lang="en"):
    return {
        "specversion": "1.0",
        "id": "99999999-9999-4999-8999-999999999999",
        "type": "meeting.context",
        "source": "halo/test",
        "time": "2026-10-31T09:00:00Z",
        "meetingid": MEETING,
        "datacontenttype": "application/json",
        "data": {"subject": "Launch", "agenda": ["dates"], "roles": [],
                 "viewer_lang": viewer_lang},
    }


def mapped_envelope(corrects, tile="t2", name="Omar"):
    return {
        "specversion": "1.0",
        "id": "88888888-8888-4888-8888-888888888888",
        "type": "speaker.mapped",
        "source": "halo/test",
        "time": "2026-10-31T09:00:00Z",
        "meetingid": MEETING,
        "datacontenttype": "application/json",
        "data": {"speaker": "s1", "tile_id": tile, "name": name,
                 "locked": True, "corrects": corrects},
    }


def setup(replies):
    clock = Clock()
    bus = Bus()
    llm = FakeLLM(clock, replies)
    insight = Insight(bus, llm, clock=clock)
    # Production flushes from the 250 ms loop (the handler never awaits the
    # model); here a flush right after each turn keeps the timing deterministic.
    bus.subscribe("turn.attributed", lambda _e: insight.flush())
    points, health = [], []
    bus.subscribe("points.upsert", points.append)
    bus.subscribe("llm.health", health.append)
    return clock, bus, llm, insight, points, health


def test_turn_produces_point_in_viewer_language():
    async def run():
        _clock, bus, llm, _insight, points, health = setup(
            [point_reply("Launch moves to Nov 12", quote="Launch moves")])
        await bus.publish(context_envelope("ar"))
        await bus.publish(turn_envelope("00000030-0000-4000-8000-000000000030",
                                        "Launch moves to Nov 12"))
        assert len(points) == 1 and len(llm.calls) == 1
        point = points[0]["data"]
        assert validate_envelope(points[0]) == []
        assert point["lang"] == "ar" and point["quote"] == "Launch moves"
        assert point["turn_ids"] == ["00000030-0000-4000-8000-000000000030"]
        assert point["engine"] == "spark-open" and point["rank"] == 1
        assert llm.calls[0]["prompt_cache_key"] == PROMPT_CACHE_KEY
        assert "Launch moves to Nov 12" in llm.calls[0]["prompt"]
        assert len(health) == 1 and health[0]["data"]["engine"] == "spark-open"
        assert health[0]["data"]["p90_ms"] < 4000

    asyncio.run(run())


def test_second_turn_within_3s_coalesces():
    async def run():
        clock, bus, llm, _, points, _ = setup(
            [point_reply("first"), point_reply("both")])
        t1, t2 = ("00000031-0000-4000-8000-000000000031",
                  "00000032-0000-4000-8000-000000000032")
        await bus.publish(turn_envelope(t1, "first words"))
        await bus.publish(turn_envelope(t2, "second words"))
        assert len(llm.calls) == 1 and len(points) == 1  # held, not dropped
        clock.advance(3.0)
        t3 = "00000033-0000-4000-8000-000000000033"
        await bus.publish(turn_envelope(t3, "third words", ts=4000))
        assert len(llm.calls) == 2
        assert points[1]["data"]["turn_ids"] == [t2, t3]
        assert "second words" in llm.calls[1]["prompt"]
        assert "third words" in llm.calls[1]["prompt"]

    asyncio.run(run())


def test_rpm_cap_holds_without_dropping():
    async def run():
        # 30 RPM (Karim 2026-11-01): the 12 RPM cap only fit Baseten's basic
        # tier, which Halo no longer uses; the contributor allows 150 RPM.
        clock, bus, llm, _, points, _ = setup([point_reply(f"p{i}") for i in range(31)])
        for i in range(30):
            tid = f"1000000{i:02d}-0000-4000-8000-0000000000{i:02d}"
            await bus.publish(turn_envelope(tid, f"words {i}", name=f"Speaker {i}"))
        assert len(llm.calls) == 30
        held_id = "20000000-0000-4000-8000-000000000020"
        await bus.publish(turn_envelope(held_id, "held words", name="Late"))
        assert len(llm.calls) == 30 and len(points) == 30  # capped, kept
        clock.advance(61.0)
        await bus.publish(turn_envelope("30000000-0000-4000-8000-000000000030",
                                        "nudge", name="Nudge"))
        assert len(llm.calls) == 32  # held + nudge, nothing lost
        ids = [p["data"]["turn_ids"][0] for p in points]
        assert held_id in ids

    asyncio.run(run())


def test_corrects_resend_without_model_call():
    async def run():
        _, bus, llm, _, points, _ = setup([point_reply("Launch moves")])
        tid = "00000030-0000-4000-8000-000000000030"
        await bus.publish(turn_envelope(tid, "Launch moves"))
        assert len(points) == 1
        calls = len(llm.calls)
        await bus.publish(mapped_envelope([tid]))
        assert len(llm.calls) == calls  # zero new model calls
        assert len(points) == 2
        first, fixed = points[0]["data"], points[1]["data"]
        assert fixed["point_id"] == first["point_id"]
        assert (fixed["tile_id"], fixed["speaker_name"], fixed["attribution"]) == ("t2", "Omar", "locked")
        assert fixed["text"] == first["text"]
        assert validate_envelope(points[1]) == []

    asyncio.run(run())


def test_replaces_passes_through_on_new_points():
    async def run():
        _, bus, _, _, points, _ = setup(
            [point_reply("old"), point_reply("new",
                                             replaces="00000040-0000-4000-8000-000000000040")])
        await bus.publish(turn_envelope("00000030-0000-4000-8000-000000000030",
                                        "old words", name="Layla"))
        await bus.publish(turn_envelope("00000031-0000-4000-8000-000000000031",
                                        "new words", name="Omar"))
        assert points[0]["data"].get("replaces") is None
        assert points[1]["data"]["replaces"] == "00000040-0000-4000-8000-000000000040"
        assert points[1]["data"]["point_id"] != points[0]["data"]["point_id"]
        assert validate_envelope(points[1]) == []

    asyncio.run(run())


def test_late_context_applies_to_later_turns_only():
    async def run():
        clock, bus, _, _, points, _ = setup([point_reply("one"), point_reply("two")])
        await bus.publish(turn_envelope("00000030-0000-4000-8000-000000000030",
                                        "one", name="Layla"))
        await bus.publish(context_envelope("ar"))
        clock.advance(3.0)
        await bus.publish(turn_envelope("00000031-0000-4000-8000-000000000031",
                                        "two", name="Layla", ts=4000))
        assert [p["data"]["lang"] for p in points] == ["en", "ar"]

    asyncio.run(run())


def test_llm_health_on_change_then_throttled():
    async def run():
        clock, bus, _llm, _, _, health = setup(
            [point_reply("one"), dict(point_reply("two"), engine="muse-spark-1.3-contributor"),
             point_reply("three")])
        await bus.publish(turn_envelope("00000030-0000-4000-8000-000000000030",
                                        "one", name="A"))
        await bus.publish(turn_envelope("00000031-0000-4000-8000-000000000031",
                                        "two", name="B"))
        await bus.publish(turn_envelope("00000032-0000-4000-8000-000000000032",
                                        "three", name="C"))
        engines = [h["data"]["engine"] for h in health]
        assert engines == ["spark-open", "muse-spark-1.3-contributor", "spark-open"]
        clock.advance(30.0)
        await bus.publish(turn_envelope("00000033-0000-4000-8000-000000000033",
                                        "four", name="D"))
        # Same engine, but 30 s passed: the throttled heartbeat fires.
        assert [h["data"]["engine"] for h in health] == [
            "spark-open", "muse-spark-1.3-contributor", "spark-open", "spark-open"]

    asyncio.run(run())


def test_failed_call_requeues_turns():
    async def run():
        clock, bus, llm, _, points, _ = setup([{"fail": True}, point_reply("recovered")])
        tid = "00000030-0000-4000-8000-000000000030"
        await bus.publish(turn_envelope(tid, "fragile words"))
        assert points == [] and len(llm.calls) == 1  # failed: kept, not dropped
        clock.advance(3.0)
        tid2 = "00000031-0000-4000-8000-000000000031"
        await bus.publish(turn_envelope(tid2, "more words", ts=4000))
        assert len(llm.calls) == 2
        assert points[0]["data"]["turn_ids"] == [tid, tid2]

    asyncio.run(run())


def test_turn_handler_never_awaits_the_model():
    # Found live: a 4 s model call inside the turn handler froze bus.publish
    # (transcriber, correlator and gateway ACKs) for every turn.
    async def run():
        clock = Clock()
        bus = Bus()
        llm = FakeLLM(clock, [point_reply("Launch moves")])
        Insight(bus, llm, clock=clock)
        await bus.publish(turn_envelope("00000030-0000-4000-8000-000000000030", "Launch moves"))
        assert llm.calls == []

    asyncio.run(run())


def published_quote(turn_text, model_quote):
    async def run():
        _clock, bus, _llm, _insight, points, _health = setup(
            [point_reply("Need more engineers", quote=model_quote)])
        await bus.publish(turn_envelope("00000031-0000-4000-8000-000000000031", turn_text))
        assert len(points) == 1
        return points[0]["data"]["quote"]

    return asyncio.run(run())


def test_reordered_quote_snaps_to_the_verbatim_span():
    # Live 2026-11-01, Egyptian clip: Insight moved "testing" to the end.
    quote = published_quote("testing I think we need two more engineers on",
                            "I think we need two more engineers on testing")
    assert quote == "I think we need two more engineers on"


def test_mixed_arabic_english_quote_keeps_the_source_punctuation():
    quote = published_quote("خلينا نخلص الـ testing، I think we need two more engineers on this.",
                            "نخلص الـ testing I think we need two more engineers")
    assert quote == "نخلص الـ testing، I think we need two more engineers"


def test_quote_with_no_shared_words_falls_back_to_the_turn_text():
    quote = published_quote("محتاجين اتنين مهندسين كمان", "We need two more engineers.")
    assert quote == "محتاجين اتنين مهندسين كمان"


def test_quote_may_span_the_points_coalesced_turns():
    async def run():
        clock, bus, _llm, _insight, points, _health = setup(
            [point_reply("first"), point_reply("x", quote="engineers on this. Starting Monday")])
        await bus.publish(turn_envelope("00000032-0000-4000-8000-000000000032", "first"))
        await bus.publish(turn_envelope("00000033-0000-4000-8000-000000000033",
                                        "two more engineers on this."))
        await bus.publish(turn_envelope("00000034-0000-4000-8000-000000000034",
                                        "Starting Monday please"))
        clock.advance(3.0)
        await _insight.flush()
        assert points[-1]["data"]["quote"] == "engineers on this. Starting Monday"

    asyncio.run(run())



class GateLLM:
    """Thread-blocking model fake: Layla's first call waits until another
    call has started, so the test proves overlap without wall-clock limits.
    Records the most calls in flight per speaker and overall."""

    def __init__(self) -> None:
        import threading
        self._lock = threading.Lock()
        self.other_started = threading.Event()
        self.release = threading.Event()
        self.inflight: dict[str, int] = {}
        self.max_per_speaker = 0
        self.overlapped = False
        self.prompts: list[str] = []

    def complete_json(self, *, prompt, schema, schema_name="insight.point",
                      system=None, prompt_cache_key=None):
        name = prompt.rsplit("New words from ", 1)[-1].split(":", 1)[0]
        with self._lock:
            self.prompts.append(prompt)
            self.inflight[name] = self.inflight.get(name, 0) + 1
            self.max_per_speaker = max(self.max_per_speaker, self.inflight[name])
            if sum(self.inflight.values()) > 1:
                self.overlapped = True
            first_layla = name == "Layla" and not self.release.is_set() and len(self.prompts) == 1
        if name != "Layla":
            self.other_started.set()
        if first_layla:
            self.other_started.wait(5)
            self.release.wait(5)
        with self._lock:
            self.inflight[name] -= 1
        text = prompt.rsplit("- ", 1)[-1]
        return SimpleNamespace(ok=True, engine="muse-spark-1.3-contributor", error=None,
                               data={"kind": "point", "text": text, "quote": text,
                                     "rank": 1, "urgency": "medium", "is_action": False})

    def health(self):
        return {"engine": "muse-spark-1.3-contributor", "failover": True}


def test_calls_overlap_across_speakers_but_never_for_one_speaker():
    # Live 2026-11-01: contributor calls take ~4 s, and one call at a time made
    # a second speaker's turn wait for the first call, then its own (p90 ~9 s).
    async def run():
        bus = Bus()
        llm = GateLLM()
        insight = Insight(bus, llm, flush_interval_s=0.01, speaker_window_s=0.0)
        points: list[dict] = []
        bus.subscribe("points.upsert", points.append)
        insight.start()
        try:
            await bus.publish(turn_envelope("11111111-1111-4111-8111-000000000001", "Launch on the 15th", name="Layla"))
            for _ in range(500):  # Layla's first call is in flight (holding only her first turn)
                if llm.prompts:
                    break
                await asyncio.sleep(0.01)
            await bus.publish(turn_envelope("11111111-1111-4111-8111-000000000002", "QA is not done", name="Omar", tile="t2"))
            await bus.publish(turn_envelope("11111111-1111-4111-8111-000000000003", "Ads wait for December", name="Layla"))
            await asyncio.to_thread(llm.other_started.wait, 5)
            for _ in range(200):  # Omar's point lands while Layla's call is still blocked
                if any(p["data"]["speaker_name"] == "Omar" for p in points):
                    break
                await asyncio.sleep(0.01)
            omar_first = [p["data"]["speaker_name"] for p in points] == ["Omar"]
            llm.release.set()
            for _ in range(300):
                if len(points) >= 3:
                    break
                await asyncio.sleep(0.01)
        finally:
            llm.release.set()
            insight.stop()
        assert omar_first, "Omar's point waited for Layla's call"
        assert llm.overlapped
        assert llm.max_per_speaker == 1, "two calls for one speaker at once"
        # Layla's second turn, sent while her call was in flight, went into her next call.
        assert "Ads wait for December" in llm.prompts[-1]
        assert sorted(p["data"]["speaker_name"] for p in points) == ["Layla", "Layla", "Omar"]
    asyncio.run(run())


def test_a_call_that_raises_requeues_its_turns():
    class Boom(FakeLLM):
        def complete_json(self, **kw):
            if not self.calls:
                self.calls.append(kw)
                raise RuntimeError("client blew up")
            return super().complete_json(**kw)

    async def run():
        clock = Clock()
        bus = Bus()
        insight = Insight(bus, Boom(clock, [point_reply("recovered")]), clock=clock)
        bus.subscribe("turn.attributed", lambda _e: insight.flush())
        points: list[dict] = []
        bus.subscribe("points.upsert", points.append)
        await bus.publish(turn_envelope("11111111-1111-4111-8111-000000000004", "Ship it Monday"))
        assert points == []
        clock.advance(3.0)
        await insight.flush()
        assert [p["data"]["turn_ids"] for p in points] == [["11111111-1111-4111-8111-000000000004"]]
    asyncio.run(run())
