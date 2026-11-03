"""Ask across meetings: retrieval picks the right passages, citations come
from the store (never the model), and the model is skipped when nothing matches."""

from __future__ import annotations

from types import SimpleNamespace

from halo.notes_service.ask import answer, norm, score

PASSAGES = [
    {"meeting_id": "m1", "subject": "Launch sync", "date": "2026-11-01", "speaker": "Omar",
     "scope": "point", "line": "t1", "snippet": "Omar owns the signup numbers by Thursday"},
    {"meeting_id": "m1", "subject": "Launch sync", "date": "2026-11-01", "speaker": "Layla",
     "scope": "transcript", "line": "t2", "snippet": "الإطلاق يكون في خمسة عشر يناير"},
    {"meeting_id": "m2", "subject": "Dashboard review", "date": "2026-11-02", "speaker": "Joanna",
     "scope": "point", "line": "t3", "snippet": "Ship the dashboard to everyone in December"},
]


class FakeLLM:
    def __init__(self, replies):
        self.replies = list(replies)
        self.prompts: list[str] = []

    def complete_json(self, *, prompt, schema, schema_name="", system=None, prompt_cache_key=None):
        self.prompts.append(prompt)
        data = self.replies.pop(0)
        if data is None:
            return SimpleNamespace(ok=False, engine="x", data=None, error={"code": "engine_error"})
        return SimpleNamespace(ok=True, engine="muse-spark-1.3-contributor", data=data, error=None)


def test_arabic_letters_normalise_and_the_article_drops():
    assert norm("الإطلاق") == norm("اطلاق")
    assert score("الإطلاق يكون في يناير", ["اطلاق"]) == 1
    assert score("Launch moves", ["launch"]) == 1 and score("Launch moves", ["pricing"]) == 0


def test_citations_are_store_text_and_bad_numbers_drop():
    llm = FakeLLM([{"terms": ["launch", "اطلاق", "signup"]},
                   {"answer": "Launch is Jan 15; Omar brings signups Thursday.", "cites": [2, 1, 9, 2]}])
    out = answer(llm, "When is the launch?", PASSAGES)
    assert out["answer"].startswith("Launch is Jan 15")
    # cites map back to the numbered passages the model saw; 9 is out of range, 2 repeats
    lines = [c["line"] for c in out["citations"]]
    assert len(lines) == 2 and set(lines) <= {"t1", "t2"}
    assert all(c["snippet"] in {p["snippet"] for p in PASSAGES} for c in out["citations"])
    assert out["engine"] == "muse-spark-1.3-contributor"
    assert "Ship the dashboard" not in llm.prompts[1]  # off-topic passage never sent


def test_nothing_matches_means_no_answer_call():
    llm = FakeLLM([{"terms": ["budget"]}])
    out = answer(llm, "What was the budget?", PASSAGES)
    assert out["citations"] == [] and len(llm.prompts) == 1
    assert out["answer"]


def test_keyword_call_failing_still_searches_the_question_words():
    llm = FakeLLM([None, {"answer": "December, per Joanna.", "cites": [1]}])
    out = answer(llm, "dashboard ship date?", PASSAGES)
    assert [c["line"] for c in out["citations"]] == ["t3"]


def test_answer_call_failing_is_an_error_not_an_invented_answer():
    llm = FakeLLM([{"terms": ["launch", "اطلاق"]}, None])
    out = answer(llm, "When is the launch?", PASSAGES)
    assert out.get("error") and out["citations"] == []


def test_api_ask_over_a_seeded_meeting(tmp_path):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from halo.bus import Bus
    from halo.notes_service import NotesService
    from halo.notes_service.notes_service import router
    from test_notes_service import T1, seed_db  # type: ignore[import-not-found]  # same folder, on sys.path under pytest

    data = tmp_path / "data"
    data.mkdir()
    seed_db(data / "events.sqlite")
    llm = FakeLLM([{"terms": ["launch", "date"]}, {"answer": "Nov 12, per Layla.", "cites": [1]}])
    app = FastAPI()
    app.state.notes_service = NotesService(Bus(), data_dir=data, static_dir=tmp_path, llm=llm)
    app.include_router(router)
    client = TestClient(app)
    host = {"host": "127.0.0.1:8765"}
    res = client.post("/api/ask", json={"q": "When is the launch?"}, headers=host)
    assert res.status_code == 200
    body = res.json()
    assert body["answer"] == "Nov 12, per Layla." and body["citations"][0]["meeting_id"]
    assert body["citations"][0]["line"] in (T1, None)
    assert client.post("/api/ask", json={"q": "x"}, headers={**host, "origin": "https://evil.example"}
                       ).status_code == 403
    assert client.post("/api/ask", json={"q": ""}, headers=host).status_code == 400
    assert client.post("/api/ask", json={"q": "a" * 301}, headers=host).status_code == 400
