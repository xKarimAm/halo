"""PLAN Done cases (1)-(8) for rig/fakes. Seams: the two engines' public
feed/complete calls, the env config seam, and the LLM HTTP wire shape."""

from __future__ import annotations

import json
import uuid

import pytest

from rig.fakes.config import engine_config, fakes_enabled
from rig.fakes.fake_asr import FakeASR, SessionDropped
from rig.fakes.fake_llm import FakeLLM
from rig.fakes.scripts import load_asr_script, load_llm_script

T0 = 1_000_000
FRAME_MS = 100
PCM_100MS = b"\x00\x00" * 1600  # 1600 samples * 2 bytes = 100 ms at 16 kHz mono PCM16


def asr(tmp_path, lines):
    p = tmp_path / "asr_script.jsonl"
    p.write_text("\n".join(json.dumps(x) for x in lines), encoding="utf-8")
    return load_asr_script(p)


def llm(tmp_path, lines):
    p = tmp_path / "llm_script.jsonl"
    p.write_text("\n".join(json.dumps(x) for x in lines), encoding="utf-8")
    return load_llm_script(p)


# (1) fed the fixture's PCM, emits scripted turns at scripted offsets (±200 ms)
def test_asr_emits_turns_at_scripted_offsets(tmp_path):
    script = asr(tmp_path, [
        {"stream": "tab", "speaker": "A", "text": "hello world", "lang": "en",
         "ts_start_ms": 0, "ts_end_ms": 900},
        {"stream": "tab", "speaker": "B", "text": "second turn", "lang": "en",
         "ts_start_ms": 2000, "ts_end_ms": 2900},
    ])
    fake = FakeASR(script)
    got = []
    for i in range(30):  # 3 s of audio
        got += fake.feed_audio("tab", T0 + i * FRAME_MS, PCM_100MS)
    assert [g["text"] for g in got] == ["hello world", "second turn"]
    assert abs(got[0]["ts_start_ms"] - T0) <= 200
    assert abs(got[1]["ts_start_ms"] - (T0 + 2000)) <= 200
    assert got[0]["ts_end_ms"] > got[0]["ts_start_ms"]
    uuid.UUID(got[0]["turn_id"])  # transcript.final shape


# (2) latency knob delays turns by the set amount
def test_asr_latency_knob_delays(tmp_path):
    script = asr(tmp_path, [
        {"stream": "tab", "speaker": "A", "text": "hi", "lang": "en",
         "ts_start_ms": 0, "ts_end_ms": 500},
    ])
    fake = FakeASR(script, latency_ms=500)
    assert fake.feed_audio("tab", T0, PCM_100MS) == []
    got = []
    for i in range(1, 8):
        got += fake.feed_audio("tab", T0 + i * FRAME_MS, PCM_100MS)
    assert [g["text"] for g in got] == ["hi"]


# (3) forced session drop closes the stream mid-flight on command
def test_asr_forced_drop(tmp_path):
    script = asr(tmp_path, [
        {"stream": "tab", "speaker": "A", "text": "hi", "lang": "en",
         "ts_start_ms": 0, "ts_end_ms": 500},
    ])
    fake = FakeASR(script)
    fake.feed_audio("tab", T0, PCM_100MS)
    fake.drop_session()
    assert fake.dropped is True
    with pytest.raises(SessionDropped):
        fake.feed_audio("tab", T0 + FRAME_MS, PCM_100MS)


# (4) AR/EN code-switch script emits mixed-language turns unsplit
def test_asr_code_switch_mixed(tmp_path):
    script = asr(tmp_path, [
        {"stream": "tab", "speaker": "A", "text": "okay خلينا نبدأ now", "lang": "mixed",
         "ts_start_ms": 0, "ts_end_ms": 900},
    ])
    fake = FakeASR(script)
    got = fake.feed_audio("tab", T0, PCM_100MS)
    assert len(got) == 1 and got[0]["lang"] == "mixed"


POINT_SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["point", "question", "decision", "pushback"]},
        "text": {"type": "string"},
    },
    "required": ["kind", "text"],
    "additionalProperties": False,
}


# (5) canned JSON for the matched turn, validates against the caller's schema
def test_llm_matches_by_prompt_substring_and_validates(tmp_path):
    script = llm(tmp_path, [
        {"match": "pricing", "response": {"kind": "decision", "text": "Fix price at 10"}},
        {"match": "roadmap", "response": {"kind": "point", "text": "Ship in March"}},
    ])
    fake = FakeLLM(script)
    out = fake.complete("what about pricing for Q3?", schema=POINT_SCHEMA)
    body = json.loads(out["choices"][0]["message"]["content"])
    assert body == {"kind": "decision", "text": "Fix price at 10"}
    # fallback: next unplayed canned reply in order
    out2 = fake.complete("unmatched prompt")
    assert json.loads(out2["choices"][0]["message"]["content"])["text"] == "Ship in March"


# (6) latency-spread knob pushes chosen calls past 4 s (drives llm failover)
def test_llm_latency_spread_past_4s(tmp_path):
    script = llm(tmp_path, [{"match": "x", "response": {"kind": "point", "text": "t"}}])
    slept: list[float] = []
    fake = FakeLLM(script, latency_spread={0: 4500}, sleep_fn=slept.append)
    fake.complete("x")
    assert fake.last_latency_ms > 4000 and slept == [4500]


# (7) invalid-JSON-rate knob returns malformed bodies at the set rate
def test_llm_invalid_json_rate(tmp_path):
    script = llm(tmp_path, [{"match": "x", "response": {"kind": "point", "text": "t"}}])
    fake = FakeLLM(script, invalid_json_rate=1.0)
    content = fake.complete("x")["choices"][0]["message"]["content"]
    with pytest.raises(json.JSONDecodeError):
        json.loads(content)
    clean = FakeLLM(script, invalid_json_rate=0.0)
    json.loads(clean.complete("x")["choices"][0]["message"]["content"])


# (8) flag off: the backend's real client config is byte-identical
def test_flag_off_real_config_identical():
    assert fakes_enabled({}) is False
    assert fakes_enabled({"HALO_FAKES": "1"}) is True
    real = engine_config({})
    assert real == {
        "asr_url": "wss://api.meta.ai/v1/asr/realtime",
        "llm_url": "https://inference.baseten.co/v1",
        "llm_model": "spark-open",
    }
    fake = engine_config({"HALO_FAKES": "1"})
    assert fake["llm_url"] != real["llm_url"] and fake["asr_url"] != real["asr_url"]
    assert fake["llm_model"] == real["llm_model"]  # only endpoints switch


# Wire shape (joined gate, issue #23): the ASR WebSocket speaks the real Voice
# lifecycle per connection, routed by the handshake mode, on script offsets:
# int turnIds, transcript partials without turnId, the speaker label at the
# END of the turn, completion when the audio horizon passes ts_end.
def test_asr_ws_voice_lifecycle_per_connection(tmp_path):
    import shutil

    from fastapi.testclient import TestClient

    from rig.fakes.server import create_app

    asr(tmp_path, [
        {"stream": "tab", "speaker": "A", "text": "hello world", "lang": "en",
         "ts_start_ms": 0, "ts_end_ms": 900},
    ])
    fixture_dir = tmp_path / "fx"
    fixture_dir.mkdir()
    shutil.copy(tmp_path / "asr_script.jsonl", fixture_dir / "asr_script.jsonl")
    (fixture_dir / "llm_script.jsonl").write_text("", encoding="utf-8")
    client = TestClient(create_app(fixture_dir))
    with client.websocket_connect("/v1/voice/realtime") as ws:
        ws.send_json({"mode": "DIARIZATION", "keywords": []})
        ws.send_bytes(PCM_100MS * 5)  # horizon 500: turn open, not complete
        first = [ws.receive_json() for _ in range(2)]
        assert [g["type"] for g in first] == ["speechStart", "transcript"]
        assert first[0]["turnId"] == 0 and first[0]["audioProcessedMs"] == 0
        assert first[1]["transcript"] == "hello world" and "turnId" not in first[1]
        ws.send_bytes(PCM_100MS * 5)  # horizon 1000: completion due
        last = [ws.receive_json() for _ in range(3)]
    assert [g["type"] for g in last] == ["speaker", "speechEnd", "speechComplete"]
    assert last[0]["label"] == "A" and "turnId" not in last[0]
    assert last[2]["transcript"] == "hello world" and last[2]["audioProcessedMs"] == 900
    # A mic (ENDPOINTING) connection gets no tab turns (receive times out).
    import concurrent.futures

    with client.websocket_connect("/v1/voice/realtime") as ws:
        ws.send_json({"mode": "ENDPOINTING"})
        ws.send_bytes(PCM_100MS * 5)
        pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        try:
            with pytest.raises(concurrent.futures.TimeoutError):
                pool.submit(ws.receive_json).result(timeout=1.5)
        finally:
            pool.shutdown(wait=False)


# Gate 7: a dropped Voice session resumes on reconnect. The script, the
# open turns and the turn counter live as long as the app, so a turn that
# started before the drop still completes after it — exactly once, with a
# turnId no other turn reuses.
def test_asr_session_resumes_across_reconnect_without_dup(tmp_path):
    from fastapi.testclient import TestClient

    from rig.fakes.scripts import load_asr_script
    from rig.fakes.server import create_asr_app

    asr(tmp_path, [
        {"stream": "tab", "speaker": "A", "text": "first turn here", "lang": "en",
         "ts_start_ms": 0, "ts_end_ms": 2000},
        {"stream": "tab", "speaker": "A", "text": "second turn here", "lang": "en",
         "ts_start_ms": 3000, "ts_end_ms": 4000},
    ])
    app = create_asr_app(load_asr_script(tmp_path / "asr_script.jsonl"))
    client = TestClient(app)
    with client.websocket_connect("/v1/voice/realtime") as ws:
        ws.send_json({"mode": "DIARIZATION"})
        ws.send_bytes(PCM_100MS * 5)  # horizon 500: first turn open
        first = [ws.receive_json() for _ in range(2)]
        assert [g["type"] for g in first] == ["speechStart", "transcript"]
        ws.send_text("control.drop")  # server closes the session mid-turn
    with client.websocket_connect("/v1/voice/realtime") as ws:
        ws.send_json({"mode": "DIARIZATION"})
        ws.send_bytes(PCM_100MS * 15)  # horizon 2000: first turn completes
        end = [ws.receive_json() for _ in range(3)]
        assert [g["type"] for g in end] == ["speaker", "speechEnd", "speechComplete"]
        assert end[2]["transcript"] == "first turn here"
        assert end[2]["turnId"] == first[0]["turnId"] == 0  # same turn, finished late
        ws.send_bytes(PCM_100MS * 25)  # horizon 4500: second turn due
        rest = [ws.receive_json() for _ in range(5)]
    assert [g["type"] for g in rest] == [
        "speechStart", "transcript", "speaker", "speechEnd", "speechComplete",
    ]
    assert rest[4]["transcript"] == "second turn here"
    assert rest[4]["turnId"] == 1  # no id reuse across the drop


# Gate 7: HALO_FAKE_PORT moves the fake rig off 18777 so parallel runs never
# share one fake server; unset keeps the default URLs.
def test_fake_port_override():
    from rig.fakes.config import engine_config

    moved = engine_config({"HALO_FAKES": "1", "HALO_FAKE_PORT": "19999"})
    assert moved["asr_url"] == "ws://127.0.0.1:19999/v1/voice/realtime"
    assert moved["llm_url"] == "http://127.0.0.1:19999/v1"
    default = engine_config({"HALO_FAKES": "1"})
    assert default["asr_url"] == "ws://127.0.0.1:18777/v1/voice/realtime"


# Gate 7: model-keyed failure knobs — fail or slow exactly one Spark engine
# while the other keeps answering (the client sends a model per engine).
def test_llm_model_error_knob(tmp_path):
    from fastapi.testclient import TestClient
    from halo.llm.llm import ENGINES, FAILOVER_ENGINE, PRIMARY_ENGINE

    from rig.fakes.server import create_llm_app

    script = llm(tmp_path, [{"match": "pricing", "response": {"kind": "point", "text": "t"}}])
    primary_model = ENGINES[PRIMARY_ENGINE]["model"]
    client = TestClient(create_llm_app(
        FakeLLM(script), errors_by_model={primary_model: 500}))
    bad = client.post("/v1/chat/completions", json={
        "model": primary_model, "messages": [{"role": "user", "content": "pricing?"}]})
    assert bad.status_code == 500
    good = client.post("/v1/chat/completions", json={
        "model": ENGINES[FAILOVER_ENGINE]["model"],
        "messages": [{"role": "user", "content": "pricing?"}]})
    assert good.status_code == 200


# Wire shape: OpenAI-compatible HTTP surface the llm client talks to.
def test_llm_http_wire_shape(tmp_path):
    from fastapi.testclient import TestClient

    from rig.fakes.server import create_llm_app

    script = llm(tmp_path, [{"match": "pricing", "response": {"kind": "point", "text": "t"}}])
    client = TestClient(create_llm_app(FakeLLM(script)))
    r = client.post("/v1/chat/completions", json={
        "model": "spark-open",
        "messages": [{"role": "user", "content": "pricing?"}],
    })
    assert r.status_code == 200
    assert json.loads(r.json()["choices"][0]["message"]["content"])["text"] == "t"
