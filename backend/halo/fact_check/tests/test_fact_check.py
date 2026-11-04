"""Fact Check tests: a scripted search fake; tick() stands in for the loop."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from halo.bus import Bus
from halo.fact_check import FactCheck
from halo.fact_check.fact_check import MAX_CALLS

MEETING = "22222222-2222-4222-8222-222222222222"
URL = "https://a.example/1"


class FakeLLM:
    def __init__(self, reply=None) -> None:
        self.reply = reply or {"verdict": "disputed", "note": "It is about 3.1 million.", "sources": [URL]}
        self.prompts: list[str] = []

    def search_json(self, *, prompt, schema, schema_name=""):
        self.prompts.append(prompt)
        return SimpleNamespace(ok=True, engine="x", data=dict(self.reply), error=None)


def env(type_, data, n=1):
    return {"specversion": "1.0", "id": f"00000000-0000-4000-8000-{n:012d}", "type": type_,
            "source": "halo/test", "time": "2026-11-02T09:00:00Z", "meetingid": MEETING,
            "datacontenttype": "application/json", "data": data}


def point(text, n=1):
    return env("points.upsert", {"point_id": f"00000000-0000-4000-8000-{n:012d}", "speaker_name": "Omar",
                                 "text": text, "kind": "point", "lang": "en"}, n)


def run(llm, *events):
    async def go():
        bus = Bus()
        out = []

        async def grab(e):
            out.append(e)

        bus.subscribe("claim.checked", grab)
        fact = FactCheck(bus, llm)
        for e in events:
            if e["type"] == "points.upsert":
                await fact._on_point(e)
            else:
                await fact._on_context(e)
        while await fact.tick():
            pass
        await asyncio.sleep(0)
        return out

    return asyncio.run(go())


def test_a_point_with_a_number_is_checked_and_published():
    llm = FakeLLM()
    out = run(llm, point("Qatar has 10 million people."))
    assert len(out) == 1
    data = out[0]["data"]
    assert data["verdict"] == "disputed" and data["sources"] == [URL] and data["speaker_name"] == "Omar"
    assert "10 million" in llm.prompts[0]


def test_words_without_a_number_spend_nothing():
    llm = FakeLLM()
    assert run(llm, point("We should talk to the design team.")) == [] and llm.prompts == []


def test_arabic_digits_count_and_the_note_follows_the_viewer_language():
    llm = FakeLLM()
    ctx = env("meeting.context", {"viewer_lang": "ar"}, 9)
    out = run(llm, ctx, point("عدد السكان ١٠ ملايين"))
    assert "Arabic" in llm.prompts[0] and out[0]["data"]["lang"] == "ar"


def test_skip_and_unclear_stay_silent():
    for verdict in ("skip", "unclear"):
        assert run(FakeLLM({"verdict": verdict, "note": "n", "sources": [URL]}), point("We have 12 users")) == []


def test_a_verdict_without_a_source_is_dropped():
    assert run(FakeLLM({"verdict": "disputed", "note": "n", "sources": []}), point("It costs 12 dollars")) == []


def test_a_point_is_checked_once_even_when_the_classifier_reupserts_it():
    llm = FakeLLM()
    run(llm, point("It costs 12 dollars"), point("It costs 12 dollars"))
    assert len(llm.prompts) == 1


def test_spending_is_capped_per_meeting():
    llm = FakeLLM()
    run(llm, *[point(f"Item number {i}", i + 1) for i in range(MAX_CALLS + 5)])
    assert len(llm.prompts) == MAX_CALLS


def test_the_model_citation_marker_never_reaches_the_note():
    marked = "It entered into force on 1 August 2024. \u30106230298502374729676\u2020L7-L9\u3011"
    out = run(FakeLLM({"verdict": "supported", "note": marked, "sources": [URL]}), point("It began in 2024"))
    assert out[0]["data"]["note"] == "It entered into force on 1 August 2024."


def test_a_number_said_as_a_word_counts():
    for text in ("Qatar has ten million people.", "سكان قطر عشرة ملايين.", "Sales grew twenty percent."):
        llm = FakeLLM()
        run(llm, point(text))
        assert len(llm.prompts) == 1, text
