"""LLM client tests: every PLAN case against a scripted OpenAI-compatible
transport (httpx.MockTransport). No keys, no network. The client code holds
no test-only branches: production differs only by transport and keys."""

from __future__ import annotations

import base64
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


def test_429_fails_over_and_primary_4xx_fails_over_without_retry(caplog):
    """A host that rejects a request field (400) or the model id (404) must
    degrade to the contributor, not fail every Insight call. No same-engine
    retry: a rejected request stays rejected."""
    clock = Clock()
    script = Script(clock)
    script.primary.extend([(429, {"error": "busy"}, 0.0), (429, {"error": "busy"}, 0.0)])
    script.primary.append((400, {"error": "unknown field reasoning_effort"}, 0.0))
    script.primary.append((404, {"error": "no such model"}, 0.0))
    script.failover.extend([(200, GOOD, 0.1)] * 3)
    sleeps: list = []
    client = script.client(clock, sleeps)
    try:
        limited = client.complete_json(prompt=PROMPT, schema=SCHEMA)
        assert limited.ok and limited.engine == FAILOVER_ENGINE
        assert len(sleeps) == 1 and 0 < sleeps[0] <= 4.0
        for code in ("bad_request", "not_found"):
            clock.advance(30.0)  # cooldown over: the primary is tried again
            caplog.clear()
            with caplog.at_level(logging.WARNING, logger="halo.llm"):
                result = client.complete_json(prompt=PROMPT, schema=SCHEMA)
            assert result.ok and result.engine == FAILOVER_ENGINE
            warnings = [r.getMessage() for r in caplog.records]
            assert len(warnings) == 1 and code in warnings[0]
    finally:
        client.close()
    # 429s retried once then failed over; each 4xx tried once, then failed over.
    assert len(primary_calls(script)) == 4 and len(failover_calls(script)) == 3
    assert len(sleeps) == 1


def test_400_on_contributor_is_a_typed_failure():
    clock = Clock()
    script = Script(clock)
    script.primary.append((400, {"error": "bad"}, 0.0))
    script.failover.append((400, {"error": "bad"}, 0.0))
    client = script.client(clock, [])
    try:
        result = client.complete_json(prompt=PROMPT, schema=SCHEMA)
    finally:
        client.close()
    assert not result.ok and result.engine == FAILOVER_ENGINE
    assert result.error and result.error["code"] == "bad_request"
    assert len(primary_calls(script)) == 1 and len(failover_calls(script)) == 1


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


MODAL_ENV = {
    "HALO_PRIMARY_BASE_URL": "https://example-workspace--muse.modal.run/v1",
    "HALO_PRIMARY_MODEL": "meta-models/Muse-Spark-Open-816B-A42B",
    "HALO_PRIMARY_KEY_VAR": "MODAL_PROXY_TOKEN",
}


def _recording_client(env: dict, seen: list, *, meta_status: int = 200) -> LLMClient:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode())
        seen.append({"url": str(request.url), "model": body["model"],
                     "effort": body.get("reasoning_effort"),
                     "auth": request.headers.get("authorization")})
        return httpx.Response(meta_status if "api.meta.ai" in request.url.host else 200, json=GOOD)

    return LLMClient(transport=httpx.MockTransport(handler), clock=Clock(),
                     sleep=lambda s: None, env=env)


def test_env_overrides_primary_host_model_and_key():
    seen: list = []
    client = _recording_client({**MODAL_ENV, "MODAL_PROXY_TOKEN": "wk-1.ws-2"}, seen)
    try:
        result = client.complete_json(prompt=PROMPT, schema=SCHEMA)
    finally:
        client.close()
    assert result.ok and result.engine == PRIMARY_ENGINE
    assert seen == [{"url": "https://example-workspace--muse.modal.run/v1/chat/completions",
                     "model": "meta-models/Muse-Spark-Open-816B-A42B",
                     "effort": "low", "auth": "Bearer wk-1.ws-2"}]


def test_primary_defaults_unchanged_without_overrides():
    seen: list = []
    # Blank overrides (an untouched .env.example copy) keep the Baseten defaults.
    blank = {k: "" for k in MODAL_ENV}
    client = _recording_client({**blank, "BASETEN_API_KEY": "b-key"}, seen)
    try:
        assert client.complete_json(prompt=PROMPT, schema=SCHEMA).ok
    finally:
        client.close()
    assert seen == [{"url": "https://inference.baseten.co/v1/chat/completions",
                     "model": "meta-models/muse-spark-open-1026",
                     "effort": "low", "auth": "Bearer b-key"}]


def test_missing_override_key_fails_over_to_contributor():
    seen: list = []
    # Key var points at MODAL_PROXY_TOKEN, which is unset: BASETEN_API_KEY is not used.
    client = _recording_client({**MODAL_ENV, "BASETEN_API_KEY": "b-key",
                                "META_API_KEY": "m-key"}, seen)
    try:
        result = client.complete_json(prompt=PROMPT, schema=SCHEMA)
    finally:
        client.close()
    assert result.ok and result.engine == FAILOVER_ENGINE
    assert [s["url"] for s in seen] == ["https://api.meta.ai/v1/chat/completions"]


def test_overridden_host_without_key_var_never_gets_the_baseten_key():
    """HALO_PRIMARY_BASE_URL set, HALO_PRIMARY_KEY_VAR blank: the Baseten key
    went to the new host. No key var for a custom host means no key."""
    seen: list = []
    env = {**MODAL_ENV, "HALO_PRIMARY_KEY_VAR": "", "BASETEN_API_KEY": "b-key", "META_API_KEY": "m-key"}
    client = _recording_client(env, seen)
    try:
        result = client.complete_json(prompt=PROMPT, schema=SCHEMA)
    finally:
        client.close()
    assert result.ok and result.engine == FAILOVER_ENGINE
    assert all(s["auth"] != "Bearer b-key" for s in seen)
    assert all("modal.run" not in s["url"] for s in seen)


def test_no_primary_key_means_contributor_by_design_not_failover():
    """2026-11-03: with only META_API_KEY, every call ran on the contributor and
    the monitor logged "llm is failover" each time. No Spark Open key is a
    supported setup, so health names the contributor and flags no failover."""
    clock = Clock()
    script = Script(clock)
    script.failover.append((200, GOOD, 0.1))
    client = LLMClient(meta_key="test-meta", transport=httpx.MockTransport(script.handler),
                       clock=clock, sleep=lambda s: None, env={})
    try:
        assert client.health() == {"engine": FAILOVER_ENGINE, "failover": False}
        assert client.complete_json(prompt=PROMPT, schema=SCHEMA).ok
        assert client.health() == {"engine": FAILOVER_ENGINE, "failover": False}
        assert primary_calls(script) == []
    finally:
        client.close()


def test_usage_counts_tokens_and_estimates_spend_per_engine():
    """Karim 2026-11-04: see what a meeting costs. Every 200 reply's `usage`
    is counted, even one that fails the schema (the tokens were billed)."""
    clock = Clock()
    script = Script(clock)
    billed = {"usage": {"prompt_tokens": 1_000_000, "completion_tokens": 100_000,
                        "prompt_tokens_details": {"cached_tokens": 200_000}}}
    script.primary.append((200, {**GOOD, **billed}, 0.1))
    script.primary.append((200, {**reply({"wrong": 1}), **billed}, 0.1))  # schema fails, still billed
    script.primary.append((200, {**reply({"wrong": 1}), **billed}, 0.1))
    script.failover.append((200, {**GOOD, "usage": {"prompt_tokens": 500_000, "completion_tokens": 0}}, 0.1))
    sleeps: list = []
    client = script.client(clock, sleeps)
    try:
        client.complete_json(prompt=PROMPT, schema=SCHEMA)
        client.complete_json(prompt=PROMPT, schema=SCHEMA)  # bad twice: fails over
        usage = client.usage()
    finally:
        client.close()
    spark = usage[PRIMARY_ENGINE]
    assert (spark["calls"], spark["in"], spark["cached"], spark["out"]) == (3, 3_000_000, 600_000, 300_000)
    # Baseten list price: $1.25 in, $0.15 cached in, $4.25 out per 1M tokens.
    assert spark["usd"] == round(3 * (0.8 * 1.25 + 0.2 * 0.15 + 0.1 * 4.25), 4)
    assert usage[FAILOVER_ENGINE]["usd"] == round(0.5 * 0.10, 4)
    assert usage["usd_total"] == round(spark["usd"] + 0.05, 4)


def test_a_late_primary_reply_warning_names_the_call_and_its_time(caplog):
    """Live 2026-11-04: six 'spark-open failed (timeout)' warnings in five
    minutes, none saying which call or how slow; the budget could not be sized."""
    clock = Clock()
    script = Script(clock)
    script.primary.append((200, GOOD, 5.2))
    script.failover.append((200, GOOD, 0.1))
    client = script.client(clock, [])
    try:
        with caplog.at_level(logging.WARNING, logger="halo.llm"):
            result = client.complete_json(prompt=PROMPT, schema=SCHEMA, schema_name="coach.tips")
    finally:
        client.close()
    assert result.ok and result.engine == FAILOVER_ENGINE
    [warning] = [r.getMessage() for r in caplog.records]
    assert "coach.tips" in warning and "5.2s" in warning


def test_idle_connections_stay_open_past_the_failover_cooldown():
    """Live 2026-11-04: httpx drops idle connections after 5 s, so the first
    call after a pause paid a new TLS handshake (3.9-4.5 s against ~2 s warm)
    and timed out at the 4 s budget, once per 30 s cooldown."""
    client = LLMClient(baseten_key="k", meta_key="k")
    try:
        assert client._http._transport._pool._keepalive_expiry >= 120
    finally:
        client.close()


FACT_SCHEMA = {
    "type": "object",
    "properties": {"verdict": {"type": "string"}, "note": {"type": "string"}},
    "required": ["verdict", "note"],
    "additionalProperties": False,
}


def search_client(handler) -> LLMClient:
    return LLMClient(baseten_key="", meta_key="mk", transport=httpx.MockTransport(handler), env={})


def search_reply(text: str) -> dict:
    return {"usage": {"input_tokens": 2000, "output_tokens": 100}, "output": [
        {"type": "reasoning"},
        {"type": "message", "content": [{"type": "output_text", "text": "Searching."}]},
        {"type": "web_search_call", "action": {"sources": [
            {"type": "url", "url": "https://a.example/1"}, {"type": "url", "url": "https://b.example/2"}]}},
        {"type": "message", "content": [{"type": "output_text", "text": text}]}]}


def test_search_json_reads_the_last_message_and_the_real_source_urls():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(url=str(request.url), body=json.loads(request.content))
        return httpx.Response(200, json=search_reply('{"verdict": "disputed", "note": "No."}'))

    llm = search_client(handler)
    result = llm.search_json(prompt="check", schema=FACT_SCHEMA, schema_name="claim_check")
    assert result.ok and result.data == {"verdict": "disputed", "note": "No.",
                                         "sources": ["https://a.example/1", "https://b.example/2"]}
    assert seen["url"].endswith("/responses")
    assert seen["body"]["model"] == "muse-spark-1.3-contributor"
    assert seen["body"]["tools"] == [{"type": "web_search"}]
    assert seen["body"]["include"] == ["web_search_call.action.sources"]
    assert llm.usage()[FAILOVER_ENGINE]["in"] == 2000  # counted in the health.json spend


def test_search_json_fails_soft():
    assert not search_client(lambda r: httpx.Response(500)).search_json(prompt="p", schema=FACT_SCHEMA).ok
    assert not search_client(lambda r: httpx.Response(200, json=search_reply("not json"))).search_json(
        prompt="p", schema=FACT_SCHEMA).ok
    calls = []
    keyless = LLMClient(baseten_key="", meta_key="", env={},
                        transport=httpx.MockTransport(lambda r: calls.append(r) or httpx.Response(500)))
    assert not keyless.search_json(prompt="p", schema=FACT_SCHEMA).ok and not calls


def test_generate_image_returns_png_bytes_from_muse_image():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(url=str(request.url), body=json.loads(request.content))
        return httpx.Response(200, json={"output": [
            {"type": "reasoning"}, {"type": "message", "content": []},
            {"type": "image_generation_call", "result": base64.b64encode(b"png-bytes").decode()}]})

    assert search_client(handler).generate_image("a recap") == b"png-bytes"
    assert seen["url"].endswith("/responses") and seen["body"]["model"] == "muse-image-1.0"
    assert seen["body"]["tools"] == [{"type": "image_generation", "output_format": "png"}]


def test_generate_image_fails_soft():
    assert search_client(lambda r: httpx.Response(500)).generate_image("a") is None
    assert search_client(lambda r: httpx.Response(200, json={"output": []})).generate_image("a") is None


def test_search_json_survives_an_odd_source_entry():
    body = search_reply('{"verdict": "supported", "note": "Yes."}')
    body["output"][2]["action"]["sources"].insert(0, "not-a-dict")
    result = search_client(lambda r: httpx.Response(200, json=body)).search_json(prompt="p", schema=FACT_SCHEMA)
    assert result.ok and result.data["sources"] == ["https://a.example/1", "https://b.example/2"]
