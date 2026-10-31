"""Wire adapters: FakeLLM as an OpenAI-compatible HTTP app, FakeASR as a
Voice-shaped WebSocket. Run: `uv run python -m rig.fakes.server` (needs a
fixture dir via HALO_FIXTURE_DIR with asr_script.jsonl / llm_script.jsonl).

Strict by design: the fakes accept only what the real engines were seen to
accept (or what the real client is known to send) and emit only the shapes
the real engines emit. Anything else fails loudly with the real engine's
error (Voice: close 1008; LLM: OpenAI-style 4xx body), never passes
silently. Evidence per rule:
- Voice: `.agents/skills/meta-model-api/voice.md` (endpoint, handshake in
  the first frame, 10 s handshake / 5 s backlog / 10 s under-real-time
  1008 rules), PR #63 (`/v1/voice/realtime` = 401; a handshake without
  model/audioEncoding = 1008 Bad Request), the day-0 probe wire shapes in
  backend/halo/transcriber/tests/soft_cut_fixture.json.
- LLM: `.agents/skills/meta-model-api/llm.md` (model ids, reasoning
  efforts, json_schema template, recursive $ref = 400, Spark Open does
  not enforce the schema and returns `reasoning_content`, the Meta API
  enforces it, error bodies carry `type` and a usually-null `code`).
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from starlette.websockets import WebSocketDisconnected

from rig.fakes.fake_asr import BYTES_PER_MS, FakeASR, SessionDropped
from rig.fakes.fake_llm import FakeLLM
from rig.fakes.scripts import load_asr_script, load_llm_script

# --- LLM ------------------------------------------------------------------

SPARK_OPEN_MODEL = "meta-models/muse-spark-open-1026"  # Baseten: schema NOT enforced
CONTRIBUTOR_MODEL = "muse-spark-1.3-contributor"  # Meta API: schema enforced
EFFORTS = {
    SPARK_OPEN_MODEL: {"none", "minimal", "low", "medium", "high", "xhigh"},
    CONTRIBUTOR_MODEL: {"none", "minimal", "low", "medium", "high"},
}
# ponytail: the request fields the real client sends (backend/halo/llm).
# A new field has never been checked against a live engine, so the fake
# refuses it until a live run proves it; add it here with that evidence.
LLM_FIELDS = {"model", "messages", "response_format", "reasoning_effort", "prompt_cache_key"}
ROLES = {"system", "user", "assistant"}


def _llm_error(status: int, message: str, type_: str) -> JSONResponse:
    return JSONResponse({"error": {"message": message, "type": type_, "code": None}},
                        status_code=status)


def _recursive_ref(node: Any, path: str = "#") -> bool:
    """A $ref pointing at itself or an ancestor (llm.md: HTTP 400)."""
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and (path == ref or path.startswith(ref.rstrip("/") + "/")):
            return True
        return any(_recursive_ref(v, f"{path}/{k}") for k, v in node.items())
    if isinstance(node, list):
        return any(_recursive_ref(v, f"{path}/{i}") for i, v in enumerate(node))
    return False


def check_llm_request(headers: Any, body: Any) -> JSONResponse | None:
    """The real engine's rejection for this request, or None when valid."""
    auth = headers.get("authorization", "")
    if not auth.startswith("Bearer ") or not auth[len("Bearer "):].strip():
        return _llm_error(401, "missing or malformed Bearer key", "authentication_error")
    if not isinstance(body, dict):
        return _llm_error(400, "body must be a JSON object", "invalid_request_error")
    extra = sorted(set(body) - LLM_FIELDS)
    if extra:
        return _llm_error(400, f"unverified request fields: {extra}", "invalid_request_error")
    model = body.get("model")
    if model not in EFFORTS:
        return _llm_error(404, f"model {model!r} not found", "not_found_error")
    if body.get("reasoning_effort") not in EFFORTS[model]:
        return _llm_error(400, f"reasoning_effort {body.get('reasoning_effort')!r} invalid for {model}",
                          "invalid_request_error")
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages or not all(
        isinstance(m, dict) and set(m) == {"role", "content"} and m["role"] in ROLES
        and isinstance(m["content"], str) for m in messages
    ):
        return _llm_error(400, "messages must be [{role, content: str}]", "invalid_request_error")
    fmt = body.get("response_format")
    js = fmt.get("json_schema") if isinstance(fmt, dict) else None
    if not (isinstance(fmt, dict) and fmt.get("type") == "json_schema" and isinstance(js, dict)
            and isinstance(js.get("name"), str) and isinstance(js.get("schema"), dict)):
        return _llm_error(400, "response_format must be json_schema {name, schema}",
                          "invalid_request_error")
    if _recursive_ref(js["schema"]):
        return _llm_error(400, "recursive $ref in schema", "invalid_request_error")
    return None


def create_llm_app(
    fake: FakeLLM,
    errors_by_model: dict[str, int] | None = None,
    sleep_by_model: dict[str, float] | None = None,
) -> FastAPI:
    """OpenAI-compatible stand-in for both Spark engines (the client sends a
    different model per engine, so gate-7 knobs are keyed by model: fail or
    slow exactly one engine while the other keeps answering)."""
    app = FastAPI()
    errors = errors_by_model or {}
    sleeps = sleep_by_model or {}

    @app.post("/v1/chat/completions")
    async def completions(request: Request):  # type: ignore[no-untyped-def]
        try:
            body = await request.json()
        except ValueError:
            return _llm_error(400, "body is not JSON", "invalid_request_error")
        rejected = check_llm_request(request.headers, body)
        if rejected is not None:
            return rejected
        model = body["model"]
        if model in sleeps:
            await asyncio.sleep(sleeps[model])
        if model in errors:
            return _llm_error(errors[model], f"fake HTTP {errors[model]} for {model}", "server_error")
        prompt = "\n".join(m["content"] for m in body["messages"])
        schema = body["response_format"]["json_schema"]["schema"]
        # Spark Open on Baseten does not enforce json_schema: a wrong canned
        # shape goes out as-is (the client must catch it). The Meta API does
        # enforce it, so there a wrong canned shape is a fixture bug: raise.
        reply = fake.complete(prompt, schema=schema, enforce=model == CONTRIBUTOR_MODEL)
        reply["model"] = model
        if model == SPARK_OPEN_MODEL:
            reply["choices"][0]["message"]["reasoning_content"] = "fake reasoning (read only content)"
        return reply

    return app


# --- Voice ----------------------------------------------------------------

VOICE_PATH = "/v1/asr/realtime"  # /v1/voice/realtime answers 401 live (PR #63): not served
VOICE_MODEL = "muse-voice-transcribe-1.0"
MODES = {"DIARIZATION": "tab", "ENDPOINTING": "mic"}
# The handshake halo.transcriber.protocol.build_handshake sends, verified
# live on 2026-10-31 (PR #63). Unknown keys fail like a bad handshake.
HANDSHAKE_FIELDS = {"authorization", "mode", "model", "audioEncoding", "partialMode",
                    "emitAudioProgress", "languageBias", "keywords"}
HANDSHAKE_TIMEOUT_S = 10.0  # voice.md: no handshake within 10 s -> 1008
MAX_BACKLOG_MS = 5000  # voice.md: more than 5 s of audio backlog -> 1008
MAX_UNDERRUN_MS = 10000  # voice.md: ingress below real time for 10 s -> 1008
BAD_REQUEST = 1008


def check_handshake(frame: Any) -> str | None:
    """Why Voice would reject this first frame (close 1008), or None."""
    if not isinstance(frame, dict):
        return "first frame must be the JSON handshake"
    extra = sorted(set(frame) - HANDSHAKE_FIELDS)
    if extra:
        return f"unknown handshake fields: {extra}"
    auth = frame.get("authorization")
    token = auth.get("accessToken") if isinstance(auth, dict) else None
    if not isinstance(token, str) or not token.startswith("Bearer ") or not token[7:].strip():
        return "authorization.accessToken must be 'Bearer <key>'"
    if frame.get("mode") not in MODES:
        return f"mode must be one of {sorted(MODES)}"
    if frame.get("model") != VOICE_MODEL:
        return f"model must be {VOICE_MODEL}"
    if frame.get("audioEncoding") != "PCM_16KHZ":
        return "audioEncoding must be PCM_16KHZ"
    return None


class _Session:
    """One Voice session per handshake mode. It outlives a connection so a
    dropped session resumes on reconnect (gate 7); tab and mic never share
    an audio clock, open turns or turnIds (each is its own Voice session)."""

    def __init__(self, script: list) -> None:
        self.fake = FakeASR(list(script))
        self.open_turns: dict[int, dict] = {}
        self.turn_seq = 0


def create_asr_app(script: list) -> FastAPI:
    """The handshake mode routes the session (DIARIZATION -> tab, ENDPOINTING
    -> mic), and turns go out as real Voice lifecycle shapes on script
    offsets from the session anchor: int turnIds, `transcript` partials
    without turnId, the `speaker` label at the END of the turn, and one turn
    per scripted (speaker-change) turn so the joined gate takes the
    transcriber's soft-cut path.

    Gate 7: each mode's script, open turns and turn counter live as long as
    the app, not the connection. A dropped session resumes where it left
    off on reconnect: the in-flight turn still completes, exactly once, and
    no turnId is ever reused."""
    app = FastAPI()
    sessions = {mode: _Session(script) for mode in MODES}

    @app.websocket(VOICE_PATH)
    async def realtime(ws: WebSocket) -> None:
        await ws.accept()
        try:
            try:
                first = await asyncio.wait_for(ws.receive(), HANDSHAKE_TIMEOUT_S)
            except TimeoutError:
                await ws.close(code=BAD_REQUEST, reason="no handshake within 10 s")
                return
            if first.get("type") == "websocket.disconnect":
                return
            try:
                handshake = json.loads(first["text"]) if first.get("text") else None
            except ValueError:
                handshake = None
            problem = check_handshake(handshake)
            if problem is not None:
                await ws.close(code=BAD_REQUEST, reason=f"Bad Request: {problem}")
                return
            mode = handshake["mode"]
            await _serve(ws, sessions[mode], MODES[mode])
        except (WebSocketDisconnect, WebSocketDisconnected, SessionDropped):
            return

    return app


async def _serve(ws: WebSocket, session: _Session, stream: str) -> None:
    fake = session.fake
    started: float | None = None
    received_ms = 0
    while True:
        msg = await ws.receive()
        if msg.get("type") == "websocket.disconnect":
            return
        if msg.get("text") == "control.drop":
            # Rig knob: drop this connection only; the session survives
            # for the reconnect (gate 7). FakeASR.drop_session still
            # poisons the engine for unit tests.
            await ws.close(code=1011)
            return
        pcm = msg.get("bytes")
        if pcm is None:
            await ws.close(code=BAD_REQUEST, reason="only binary PCM after the handshake")
            return
        if len(pcm) % 2:
            await ws.close(code=BAD_REQUEST, reason="PCM16 frames must have an even byte count")
            return
        now = time.monotonic()
        started = now if started is None else started
        received_ms += len(pcm) // BYTES_PER_MS
        wall_ms = (now - started) * 1000
        if received_ms - wall_ms > MAX_BACKLOG_MS:
            await ws.close(code=BAD_REQUEST, reason="Audio backlog too large")
            return
        if wall_ms - received_ms > MAX_UNDERRUN_MS:
            await ws.close(code=BAD_REQUEST, reason="Audio ingress below real time")
            return
        for turn in fake.feed_audio(stream, int(time.time() * 1000), pcm):
            anchor = fake.anchor_ms
            tid = session.turn_seq
            session.turn_seq += 1
            session.open_turns[tid] = turn
            await ws.send_json({"type": "speechStart", "turnId": tid,
                                "audioProcessedMs": turn["ts_start_ms"] - anchor})
            await ws.send_json({"type": "transcript", "transcript": turn["text"],
                                "final": False,
                                "audioProcessedMs": turn["ts_end_ms"] - anchor})
        anchor = fake.anchor_ms
        horizon = fake.position_ms - fake.latency_ms
        for tid in [tid for tid, turn in session.open_turns.items()
                    if turn["ts_end_ms"] - anchor <= horizon]:
            turn = session.open_turns.pop(tid)
            end = turn["ts_end_ms"] - anchor
            await ws.send_json({"type": "speaker", "label": turn["speaker"],
                                "audioProcessedMs": end})
            await ws.send_json({"type": "speechEnd", "turnId": tid, "audioProcessedMs": end})
            await ws.send_json({"type": "speechComplete", "turnId": tid,
                                "transcript": turn["text"], "audioProcessedMs": end})


def create_app(fixture_dir: str | Path) -> FastAPI:
    root = Path(fixture_dir)
    llm = create_llm_app(FakeLLM(
        load_llm_script(root / "llm_script.jsonl"),
        sleep_fn=lambda ms: time.sleep(ms / 1000),
    ))
    asr = create_asr_app(load_asr_script(root / "asr_script.jsonl"))
    llm.router.routes.extend(asr.router.routes)
    return llm


if __name__ == "__main__":
    import uvicorn

    fixture = os.environ.get("HALO_FIXTURE_DIR", "rig/fixtures/synthetic")
    port = int(os.environ.get("HALO_FAKE_PORT", "18777"))
    uvicorn.run(create_app(fixture), host="127.0.0.1", port=port)
