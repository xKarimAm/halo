"""speaking.py: the facts on a tiny two-person exchange."""

from typing import Any

from halo.notes_service.speaking import speaking_insights


def test_speaking_facts_on_a_short_exchange() -> None:
    def turn(who: str, text: str, a: int, b: int) -> dict[str, Any]:
        return {"speaker": who, "text": text, "ts_start_ms": a, "ts_end_ms": b}
    demo = [turn("Karim", "We ship Monday.", 0, 4000),
            turn("Karim", "I think maybe we can have it by Friday.", 4500, 9000),
            turn("Sara", "Why Friday and not Thursday given the tests", 9500, 14000),
            turn("Karim", "Because QA needs two days, what do you think?", 13000, 19000),
            turn("Karim", "Fine.", 30000, 31000)]
    r = speaking_insights(demo, "Karim", 0)
    assert r and r["talk_share"] == 78 and r["fair_share"] == 50, r
    assert r["longest_ms"] == 9000 and r["longest_at_ms"] == 0, r
    assert r["questions"] == 1 and r["follow_ups"] == 1, r
    assert r["cut_ins"] == [{"name": "Sara", "at_ms": 13000}], r
    assert r["hedged"][0]["quote"].startswith("I think maybe"), r
    assert r["try_next"] == {"key": "cut_ins"}, r
    assert speaking_insights(demo[:2], "Karim", 0) is None


def test_arabic_questions_count() -> None:
    turns = [{"speaker": "Layla", "text": t, "ts_start_ms": i * 5000, "ts_end_ms": i * 5000 + 4000}
             for i, t in enumerate(["متى نطلق؟ غدا.", "من المسؤول؟", "حسنا."])]
    r = speaking_insights(turns, "Layla", 0)
    assert r and r["questions"] == 2, r
