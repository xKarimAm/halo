"""LLM client tests: every PLAN case against a scripted OpenAI-compatible
transport (httpx.MockTransport). No keys, no network. The client code holds
no test-only branches: production differs only by transport and keys."""

from __future__ import annotations

import json
import logging

import httpx
from halo.llm import FAILOVER_ENGINE, PRIMARY_ENGINE, LLMClient

SCHEMA = {
    "type": "object",
    "properties": {"text": {"type": "string"}},
    "required": ["text"],
    "additionalProperties": False,
}

PROMPT = "turn: Launch moves to Nov 12"


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


def reply(data: dict, reasoning: str = "thinking...") -> dict:
    return {"choices": [{"message": {"role": "assistant",
                                     "content": json.dumps(data),
                                     "reasoning_content": reasoning}}]}


GOOD = reply({"text": "Launch moves to Nov 12"})


class Script:
    """A scripted transport: per-engine queues of (status, body, latency_s)."""

    def __init__(self, clock: Clock) -> None:
        self.clock = clock
        self.primary: list = []
        self.failover: list = []
        self.requests: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode())
        self.requests.append({"url": str(request.url), **body,
                              "auth": request.headers.get("authorization")})
        queue = self.primary if "baseten" in request.url.host else self.failover
        if not queue:
            raise AssertionError(f"unexpected call to {request.url}")
        status, payload, latency = queue.pop(0)
        self.clock.advance(latency)
        if isinstance(payload, Exception):
            raise payload
        return httpx.Response(status, json=payload)

    def client(self, clock: Clock, sleeps: list) -> LLMClient:
        return LLMClient(
            baseten_key="test-baseten", meta_key="test-meta",
            transport=httpx.MockTransport(self.handler),
            clock=clock, sleep=sleeps.append,
        )


def primary_calls(script: Script) -> list[dict]:
    return [r for r in script.requests if "baseten" in r["url"]]


def failover_calls(script: Script) -> list[dict]:
    return [r for r in script.requests if "api.meta.ai" in r["url"]]


def test_valid_primary_reply_passes_schema():
    clock = Clock()
    script = Script(clock)
    script.primary.append((200, GOOD, 0.1))
    sleeps: list = []
    client = script.client(clock, sleeps)
    try:
        result = client.complete_json(prompt=PROMPT, schema=SCHEMA)
    finally:
        client.close()
    assert result.ok and result.data == {"text": "Launch moves to Nov 12"}
    assert result.engine == PRIMARY_ENGINE
    assert len(primary_calls(script)) == 1 and failover_calls(script) == []
    assert sleeps == []


def test_bad_json_once_retries_same_engine():
    clock = Clock()
    script = Script(clock)
    script.primary.append((200, {"choices": [{"message": {"role": "assistant",
                                                         "content": "{not json"}}]}, 0.1))
    script.primary.append((200, GOOD, 0.1))
    sleeps: list = []
    client = script.client(clock, sleeps)
    try:
        result = client.complete_json(prompt=PROMPT, schema=SCHEMA)
    finally:
        client.close()
    assert result.ok and result.engine == PRIMARY_ENGINE
    assert len(primary_calls(script)) == 2 and failover_calls(script) == []


def test_bad_json_twice_fails_over_and_cools_down():
    clock = Clock()
    script = Script(clock)
    bad = {"choices": [{"message": {"role": "assistant", "content": "{not json"}}]}
    script.primary.extend([(200, bad, 0.1), (200, bad, 0.1)])
    script.failover.append((200, GOOD, 0.1))
    script.failover.append((200, GOOD, 0.1))
    sleeps: list = []
    client = script.client(clock, sleeps)
    try:
        result = client.complete_json(prompt=PROMPT, schema=SCHEMA)
        assert result.ok and result.engine == FAILOVER_ENGINE
        assert len(primary_calls(script)) == 2 and len(failover_calls(script)) == 1
        # Still cooling down: the next call goes straight to the contributor.
        again = client.complete_json(prompt=PROMPT, schema=SCHEMA)
        assert again.ok and again.engine == FAILOVER_ENGINE
        assert len(primary_calls(script)) == 2 and len(failover_calls(script)) == 2
    finally:
        client.close()


def test_slow_primary_fails_over_for_that_call_only():
    clock = Clock()
    script = Script(clock)
    script.primary.append((200, GOOD, 5.0))  # past the 4 s budget
    script.failover.append((200, GOOD, 0.1))
    script.primary.append((200, GOOD, 0.1))
    sleeps: list = []
    client = script.client(clock, sleeps)
    try:
        slow = client.complete_json(prompt=PROMPT, schema=SCHEMA)
        assert slow.ok and slow.engine == FAILOVER_ENGINE
        assert len(primary_calls(script)) == 1 and len(failover_calls(script)) == 1
        assert sleeps == []  # no same-engine retry on a timeout
        clock.advance(30.0)
        recovered = client.complete_json(prompt=PROMPT, schema=SCHEMA)
        assert recovered.ok and recovered.engine == PRIMARY_ENGINE
        assert len(primary_calls(script)) == 2
    finally:
        client.close()


def test_raised_timeout_fails_over_at_once():
    clock = Clock()
    script = Script(clock)
    script.primary.append((200, None, 0.0))
    script.failover.append((200, GOOD, 0.1))
    sleeps: list = []
    real_handler = script.handler

    def handler(request: httpx.Request) -> httpx.Response:
        if "baseten" in request.url.host:
            body = json.loads(request.content.decode())
            script.requests.append({"url": str(request.url), **body})
            script.primary.pop(0)
            raise httpx.TimeoutException("slow")
        return real_handler(request)

    client = LLMClient(baseten_key="k1", meta_key="k2",
                       transport=httpx.MockTransport(handler),
                       clock=clock, sleep=sleeps.append)
    try:
        result = client.complete_json(prompt=PROMPT, schema=SCHEMA)
    finally:
        client.close()
    assert result.ok and result.engine == FAILOVER_ENGINE
    assert len(primary_calls(script)) == 1 and len(failover_calls(script)) == 1
    assert sleeps == []


def test_429_fails_over_while_400_is_a_typed_failure():
    clock = Clock()
    script = Script(clock)
    script.primary.extend([(429, {"error": "busy"}, 0.0), (429, {"error": "busy"}, 0.0)])
    script.failover.append((200, GOOD, 0.1))
    script.primary.append((400, {"error": "bad"}, 0.0))
    sleeps: list = []
    client = script.client(clock, sleeps)
    try:
        limited = client.complete_json(prompt=PROMPT, schema=SCHEMA)
        assert limited.ok and limited.engine == FAILOVER_ENGINE
        assert len(sleeps) == 1 and 0 < sleeps[0] <= 4.0
        clock.advance(30.0)  # cooldown over: the 400 is served by the primary
        bad = client.complete_json(prompt=PROMPT, schema=SCHEMA)
        assert not bad.ok and bad.error and bad.error["code"] == "bad_request"
    finally:
        client.close()
    # 429s retried once then failed over; the 400 never retried nor failed over.
    assert len(primary_calls(script)) == 3 and len(failover_calls(script)) == 1


def test_request_shape_and_content_parsing():
    clock = Clock()
    script = Script(clock)
    script.primary.append((200, GOOD, 0.1))
    sleeps: list = []
    client = script.client(clock, sleeps)
    try:
        client.complete_json(prompt=PROMPT, schema=SCHEMA,
                             schema_name="points",
                             prompt_cache_key="insight-v1")
    finally:
        client.close()
    req = primary_calls(script)[0]
    assert req["model"] == "meta-models/muse-spark-open-1026"
    assert req["reasoning_effort"] == "low"
    assert req["response_format"] == {"type": "json_schema",
                                     "json_schema": {"name": "points", "schema": SCHEMA}}
    assert req["prompt_cache_key"] == "insight-v1"
    assert req["auth"] == "Bearer test-baseten"
    assert [m["role"] for m in req["messages"]] == ["user"]
    # reasoning_content differs from content: content is what got parsed.
    assert GOOD["choices"][0]["message"]["reasoning_content"] != GOOD["choices"][0]["message"]["content"]


def test_contributor_request_uses_minimal_effort():
    clock = Clock()
    script = Script(clock)
    bad = {"choices": [{"message": {"role": "assistant", "content": "{nope"}}]}
    script.primary.extend([(200, bad, 0.0), (200, bad, 0.0)])
    script.failover.append((200, GOOD, 0.1))
    sleeps: list = []
    client = script.client(clock, sleeps)
    try:
        result = client.complete_json(prompt=PROMPT, schema=SCHEMA)
    finally:
        client.close()
    assert result.ok and result.engine == FAILOVER_ENGINE
    req = failover_calls(script)[0]
    assert req["model"] == "muse-spark-1.3-contributor"
    assert req["reasoning_effort"] == "minimal"


def test_health_reports_engine_and_failover():
    clock = Clock()
    script = Script(clock)
    bad = {"choices": [{"message": {"role": "assistant", "content": "{nope"}}]}
    script.primary.extend([(200, bad, 0.0), (200, bad, 0.0)])
    script.failover.append((200, GOOD, 0.1))
    sleeps: list = []
    client = script.client(clock, sleeps)
    try:
        assert client.health() == {"engine": PRIMARY_ENGINE, "failover": False}
        failed = client.complete_json(prompt=PROMPT, schema=SCHEMA)
        assert failed.engine == FAILOVER_ENGINE
        assert client.health() == {"engine": FAILOVER_ENGINE, "failover": True}
    finally:
        client.close()


def test_schema_mismatch_counts_as_invalid_response():
    clock = Clock()
    script = Script(clock)
    wrong_shape = reply({"other": 1})
    script.primary.extend([(200, wrong_shape, 0.0), (200, wrong_shape, 0.0)])
    script.failover.extend([(200, wrong_shape, 0.0), (200, wrong_shape, 0.0)])
    sleeps: list = []
    client = script.client(clock, sleeps)
    try:
        result = client.complete_json(prompt=PROMPT, schema=SCHEMA)
    finally:
        client.close()
    assert not result.ok and result.error and result.error["code"] == "invalid_response"


def test_missing_keys_fail_without_requests():
    clock = Clock()
    script = Script(clock)
    client = LLMClient(transport=httpx.MockTransport(script.handler),
                       clock=clock, sleep=lambda s: None, env={})
    try:
        result = client.complete_json(prompt=PROMPT, schema=SCHEMA)
    finally:
        client.close()
    assert not result.ok and result.error and result.error["code"] == "missing_key"
    assert script.requests == []


def test_primary_401_fails_over_without_retry_and_logs_once(caplog):
    """Gate 7: a dead/revoked Baseten key must not wedge the meeting on the
    primary. One doomed primary call (no same-engine retry), then the
    contributor, one warning, cooldown engaged."""
    clock = Clock()
    script = Script(clock)
    script.primary.append((401, {"error": "bad key"}, 0.0))  # only one: a retry would blow up here
    script.failover.append((200, GOOD, 0.1))
    script.failover.append((200, GOOD, 0.1))
    sleeps: list = []
    client = script.client(clock, sleeps)
    try:
        with caplog.at_level(logging.WARNING, logger="halo.llm"):
            result = client.complete_json(prompt=PROMPT, schema=SCHEMA)
            assert result.ok and result.engine == FAILOVER_ENGINE
            assert len(primary_calls(script)) == 1 and len(failover_calls(script)) == 1
            assert sleeps == []
            assert client.health() == {"engine": FAILOVER_ENGINE, "failover": True}
            again = client.complete_json(prompt=PROMPT, schema=SCHEMA)
            assert again.ok and again.engine == FAILOVER_ENGINE
        warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
        assert len(warnings) == 1, [r.message for r in warnings]
    finally:
        client.close()


def test_missing_baseten_key_goes_straight_to_contributor(caplog):
    clock = Clock()
    script = Script(clock)
    script.failover.append((200, GOOD, 0.1))
    script.failover.append((200, GOOD, 0.1))
    client = LLMClient(baseten_key=None, meta_key="test-meta",
                       transport=httpx.MockTransport(script.handler),
                       clock=clock, sleep=lambda s: None, env={})
    try:
        with caplog.at_level(logging.WARNING, logger="halo.llm"):
            first = client.complete_json(prompt=PROMPT, schema=SCHEMA)
            assert first.ok and first.engine == FAILOVER_ENGINE
            second = client.complete_json(prompt=PROMPT, schema=SCHEMA)
            assert second.ok and second.engine == FAILOVER_ENGINE
        assert primary_calls(script) == []
        warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
        assert len(warnings) == 1, [r.message for r in warnings]
    finally:
        client.close()


def test_401_on_contributor_is_a_typed_failure():
    clock = Clock()
    script = Script(clock)
    script.primary.extend([(500, {"error": "down"}, 0.0), (500, {"error": "down"}, 0.0)])
    script.failover.append((401, {"error": "bad key"}, 0.0))
    sleeps: list = []
    client = script.client(clock, sleeps)
    try:
        result = client.complete_json(prompt=PROMPT, schema=SCHEMA)
    finally:
        client.close()
    assert not result.ok and result.error and result.error["code"] == "unauthorized"
    assert result.engine == FAILOVER_ENGINE


def test_fake_flag_swaps_both_endpoints():
    client = LLMClient(baseten_key="k1", meta_key="k2",
                       transport=httpx.MockTransport(lambda r: httpx.Response(200, json=GOOD)),
                       env={"HALO_FAKES": "1"})
    try:
        assert client._config(PRIMARY_ENGINE)["base_url"] == "http://127.0.0.1:18777/v1"
        assert client._config(FAILOVER_ENGINE)["base_url"] == "http://127.0.0.1:18777/v1"
        assert client.complete_json(prompt=PROMPT, schema=SCHEMA).ok
    finally:
        client.close()


def test_failover_engine_gets_the_longer_budget():
    # Found live: the contributor answers Insight in ~3-4.5 s; with no
    # Baseten key every point rides on it, so 4 s dropped most points.
    now = [0.0]

    def handler(request):
        now[0] += 5.0  # 5 s reply: over the 4 s primary budget, under 10 s
        return httpx.Response(200, json=GOOD)

    client = LLMClient(baseten_key="", meta_key="k2", transport=httpx.MockTransport(handler),
                       clock=lambda: now[0], sleep=lambda s: None, env={})
    try:
        result = client.complete_json(prompt=PROMPT, schema=SCHEMA)
    finally:
        client.close()
    assert result.ok and result.engine == FAILOVER_ENGINE
