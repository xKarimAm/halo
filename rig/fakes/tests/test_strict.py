"""Strict fakes: reject what the real engines reject, emit only what they
emit. Each case names its evidence (see rig/fakes/server.py docstring)."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from halo.llm.llm import ENGINES, FAILOVER_ENGINE, PRIMARY_ENGINE, LLMClient
from halo.transcriber.protocol import DIARIZATION, ENDPOINTING, build_handshake
from starlette.websockets import WebSocketDisconnect

from rig.fakes.fake_llm import FakeLLM
from rig.fakes.scripts import AsrTurn, LlmReply
from rig.fakes.server import BAD_REQUEST, VOICE_PATH, create_asr_app, create_llm_app

PCM_100MS = b"\x00\x00" * 1600
REAL_EVENTS = Path(__file__).parents[3] / "backend/halo/transcriber/tests/soft_cut_fixture.json"
TURN = AsrTurn(stream="tab", speaker="A", text="hello world", lang="en",
               ts_start_ms=0, ts_end_ms=400)
SPARK, CONTRIB = ENGINES[PRIMARY_ENGINE]["model"], ENGINES[FAILOVER_ENGINE]["model"]
POINT = {"type": "object", "properties": {"text": {"type": "string"}},
         "required": ["text"], "additionalProperties": False}


def voice(script=(TURN,)):
    return TestClient(create_asr_app(list(script)))


def closed_with(client, first, *more):
    """Send frames on a fresh Voice connection; return the close code."""
    with client.websocket_connect(VOICE_PATH) as ws:
        for frame in (first, *more):
            if isinstance(frame, bytes):
                ws.send_bytes(frame)
            elif isinstance(frame, str):
                ws.send_text(frame)
            else:
                ws.send_json(frame)
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
    return exc.value.code


# --- Voice ------------------------------------------------------------------

def test_voice_accepts_the_real_transcriber_handshake():
    client = voice()
    with client.websocket_connect(VOICE_PATH) as ws:
        ws.send_json(build_handshake(DIARIZATION, "k"))
        ws.send_bytes(PCM_100MS * 5)
        assert [ws.receive_json()["type"] for _ in range(5)] == [
            "speechStart", "transcript", "speaker", "speechEnd", "speechComplete"]


def test_voice_old_path_is_not_served():
    # PR #63: /v1/voice/realtime answers 401 live; the fake used to accept it.
    with pytest.raises(WebSocketDisconnect), voice().websocket_connect("/v1/voice/realtime"):
        pass


@pytest.mark.parametrize("drop", ["model", "audioEncoding", "authorization", "mode"])
def test_voice_rejects_handshake_missing_a_required_field(drop):
    # PR #63: a handshake without model/audioEncoding closes 1008 Bad Request.
    shake = build_handshake(DIARIZATION, "k")
    del shake[drop]
    assert closed_with(voice(), shake) == BAD_REQUEST


@pytest.mark.parametrize("change", [
    {"model": "whisper-1"},
    {"mode": "TRANSCRIPTION"},
    {"audioEncoding": "OPUS"},
    {"authorization": {"accessToken": "k"}},  # no "Bearer " prefix
    {"authorization": {"accessToken": "Bearer "}},  # empty key
    {"sampleRate": 16000},  # unknown field: never verified live
])
def test_voice_rejects_wrong_or_unknown_handshake_fields(change):
    assert closed_with(voice(), {**build_handshake(DIARIZATION, "k"), **change}) == BAD_REQUEST


def test_voice_rejects_audio_before_handshake_and_text_after():
    # voice.md: auth goes in the FIRST JSON frame.
    assert closed_with(voice(), PCM_100MS) == BAD_REQUEST
    assert closed_with(voice(), build_handshake(DIARIZATION, "k"), "hello") == BAD_REQUEST


def test_voice_rejects_odd_pcm16_frame():
    assert closed_with(voice(), build_handshake(DIARIZATION, "k"), b"\x00" * 3) == BAD_REQUEST


def test_voice_rejects_audio_backlog_over_5s():
    # voice.md + live 2026-10-31 ("Audio backlog too large"): burst > 5 s.
    assert closed_with(voice(), build_handshake(DIARIZATION, "k"), PCM_100MS * 51) == BAD_REQUEST


def test_voice_emits_only_real_event_shapes():
    """Every event type and key set matches the day-0 probe recording."""
    real: dict[str, set[str]] = {}
    for e in json.loads(REAL_EVENTS.read_text(encoding="utf-8"))["events"]:
        real.setdefault(e["type"], set()).update(k for k in e if k != "t")
    client = voice()
    with client.websocket_connect(VOICE_PATH) as ws:
        ws.send_json(build_handshake(DIARIZATION, "k"))
        ws.send_bytes(PCM_100MS * 5)
        got = [ws.receive_json() for _ in range(5)]
    for event in got:
        assert set(event) == real[event["type"]], event


def test_voice_tab_and_mic_sessions_do_not_share_state():
    """Each handshake mode is its own Voice session: a tab turn never
    completes on the mic connection, even when mic audio arrives first."""
    client = voice([AsrTurn(stream="tab", speaker="A", text="tab words", lang="en",
                            ts_start_ms=0, ts_end_ms=400)])
    with client.websocket_connect(VOICE_PATH) as tab, client.websocket_connect(VOICE_PATH) as mic:
        tab.send_json(build_handshake(DIARIZATION, "k"))
        mic.send_json(build_handshake(ENDPOINTING, "k"))
        tab.send_bytes(PCM_100MS)  # tab turn opens at horizon 100
        assert [tab.receive_json()["type"] for _ in range(2)] == ["speechStart", "transcript"]
        mic.send_bytes(PCM_100MS * 10)  # mic audio must not advance the tab clock
        tab.send_bytes(PCM_100MS * 4)  # tab horizon 500: the tab turn completes here
        assert [tab.receive_json()["type"] for _ in range(3)] == [
            "speaker", "speechEnd", "speechComplete"]


# --- LLM --------------------------------------------------------------------

def llm_client(script=None):
    replies = script or [LlmReply(match="", response={"text": "ok"})]
    return TestClient(create_llm_app(FakeLLM(replies)))


def body(model=CONTRIB, **over):
    effort = "minimal" if model == CONTRIB else "low"
    b = {"model": model, "messages": [{"role": "user", "content": "hi"}],
         "response_format": {"type": "json_schema", "json_schema": {"name": "p", "schema": POINT}},
         "reasoning_effort": effort}
    b.update(over)
    return {k: v for k, v in b.items() if v is not None}


AUTH = {"Authorization": "Bearer fake-key"}


def test_llm_accepts_exactly_what_the_real_client_sends():
    """Capture the request backend/halo/llm really builds, replay it here."""
    sent: list[httpx.Request] = []

    def capture(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(500)

    client = LLMClient(baseten_key="k", meta_key="k", transport=httpx.MockTransport(capture),
                       sleep=lambda s: None, env={})
    client.complete_json(prompt="hi", schema=POINT, system="sys", prompt_cache_key="c")
    assert {json.loads(r.content)["model"] for r in sent} == {SPARK, CONTRIB}
    fake = llm_client([LlmReply(match="", response={"text": "ok"})] * len(sent))
    for request in sent:
        r = fake.post("/v1/chat/completions", content=request.content,
                      headers={"Authorization": request.headers["authorization"],
                               "Content-Type": "application/json"})
        assert r.status_code == 200, r.text


def test_llm_rejects_missing_key_with_401():
    r = llm_client().post("/v1/chat/completions", json=body())
    assert r.status_code == 401 and r.json()["error"]["type"] == "authentication_error"
    assert r.json()["error"]["code"] is None  # llm.md: `code` is often null


def test_llm_rejects_unknown_model_with_404():
    r = llm_client().post("/v1/chat/completions", json=body(model="spark-open"), headers=AUTH)
    assert r.status_code == 404


@pytest.mark.parametrize("over", [
    {"stop": ["\n"]},  # llm.md: unsupported on the Meta API (400)
    {"n": 2},
    {"tool_choice": "required"},
    {"temperature": 0.2},  # never verified live: refused until it is
    {"reasoning_effort": "xhigh"},  # Meta ladder tops out at high
    {"reasoning_effort": None},  # every call must set its effort
    {"response_format": {"type": "json_object"}},  # the template is the contract
    {"messages": [{"role": "user", "content": [{"type": "text", "text": "hi"}]}]},
])
def test_llm_rejects_bad_requests_with_400(over):
    r = llm_client().post("/v1/chat/completions", json=body(**over), headers=AUTH)
    assert r.status_code == 400, r.text


def test_llm_rejects_recursive_ref_schema():
    tree = {"type": "object", "properties": {"kids": {"type": "array", "items": {"$ref": "#"}}}}
    fmt = {"type": "json_schema", "json_schema": {"name": "t", "schema": tree}}
    r = llm_client().post("/v1/chat/completions", json=body(response_format=fmt), headers=AUTH)
    assert r.status_code == 400


def test_spark_open_does_not_enforce_schema_but_meta_does():
    bad = [LlmReply(match="", response={"wrong": 1})]
    r = llm_client(bad).post("/v1/chat/completions", json=body(model=SPARK), headers=AUTH)
    assert r.status_code == 200  # Baseten returns the wrong shape as-is
    msg = r.json()["choices"][0]["message"]
    assert json.loads(msg["content"]) == {"wrong": 1}
    assert "reasoning_content" in msg  # Spark Open reasons; read only content
    with pytest.raises(ValueError):  # Meta enforces: a wrong canned reply is a fixture bug
        llm_client(bad).post("/v1/chat/completions", json=body(model=CONTRIB), headers=AUTH)
