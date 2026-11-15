"""HALO_GEMINI=<parts>: the listed parts go to Google with GEMINI_API_KEY.
Wire shapes are the ones Google returned on 2026-11-13 (probe). No network."""

from __future__ import annotations

import base64
import json

import httpx
from halo.llm import LLMClient

SCHEMA = {"type": "object", "properties": {"text": {"type": "string"}},
          "required": ["text"], "additionalProperties": False}
ENV = {"HALO_GEMINI": "text,search,image", "GEMINI_API_KEY": "test-gemini"}


def make(handler, env=ENV) -> LLMClient:
    return LLMClient(transport=httpx.MockTransport(handler), env=env)


def test_text_goes_to_gemini_compat_without_prompt_cache_key():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((str(request.url), request.headers["authorization"], json.loads(request.content)))
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"text": "ok"}'}}],
                                         "usage": {"prompt_tokens": 1000, "completion_tokens": 100}})

    client = make(handler)
    result = client.complete_json(prompt="p", schema=SCHEMA, prompt_cache_key="halo-x")
    url, auth, body = seen[0]
    assert result.ok and result.data == {"text": "ok"} and result.engine == "gemini-3.1-flash-lite"
    assert url == "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    assert auth == "Bearer test-gemini"
    assert body["model"] == "gemini-3.1-flash-lite" and "prompt_cache_key" not in body
    assert client.health()["engine"] == "gemini-3.1-flash-lite"
    usage = client.usage()["gemini-3.1-flash-lite"]
    assert usage["calls"] == 1 and usage["usd"] == round((1000 * 0.25 + 100 * 1.50) / 1e6, 4)


def test_text_fails_over_to_the_second_gemini_model():
    models = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        models.append(body["model"])
        if body["model"] == "gemini-3.1-flash-lite":
            return httpx.Response(503, json={"error": {"message": "high demand"}})
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"text": "ok"}'}}]})

    result = make(handler).complete_json(prompt="p", schema=SCHEMA)
    assert result.ok and result.engine == "gemini-3.8-flash"
    assert models[-1] == "gemini-3.8-flash"


GROUNDED = {"candidates": [{"content": {"parts": [{"text": "Sources report over 109 million people."}]},
                            "groundingMetadata": {"webSearchQueries": ["Egypt population"], "groundingChunks": [
                                {"web": {"uri": "https://vertexaisearch.cloud.google.com/r/1", "title": "un.org"}},
                                {"web": {"uri": "https://vertexaisearch.cloud.google.com/r/1", "title": "un.org"}}]}}],
            "usageMetadata": {"promptTokenCount": 200, "candidatesTokenCount": 50}}


def test_search_looks_up_first_then_judges_with_the_schema():
    """Measured 2026-11-13: asking for JSON (schema or words) stops Gemini searching;
    a plain look-up question searched 10/10. So: search, then a schema call."""
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "HEAD":  # the redirect link resolves to the real page
            return httpx.Response(302, headers={"location": "https://www.un.org/population"})
        body = json.loads(request.content)
        seen.append((str(request.url), body))
        if "generateContent" in str(request.url):
            assert request.headers["x-goog-api-key"] == "test-gemini"
            return httpx.Response(200, json=GROUNDED)
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"text": "disputed"}'}}]})

    result = make(handler).search_json(prompt="check: Egypt has 50 million people", schema=SCHEMA)
    (search_url, search_body), (judge_url, judge_body) = seen
    assert search_url.endswith("/v1beta/models/gemini-3.5-flash-lite:generateContent")
    assert search_body["tools"] == [{"google_search": {}}] and "JSON" not in json.dumps(search_body)
    assert judge_url.endswith("/openai/chat/completions") and judge_body["model"] == "gemini-3.1-flash-lite"
    assert "Sources report over 109 million people." in judge_body["messages"][-1]["content"]
    assert result.ok and result.engine == "gemini-3.5-flash-lite"
    assert result.data == {"text": "disputed", "sources": ["https://www.un.org/population"]}


def test_search_keeps_the_redirect_link_when_it_does_not_resolve():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "HEAD":
            raise httpx.ConnectError("offline")
        if "generateContent" in str(request.url):
            return httpx.Response(200, json=GROUNDED)
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"text": "disputed"}'}}]})

    result = make(handler).search_json(prompt="check: Egypt has 50 million people", schema=SCHEMA)
    assert result.data["sources"] == ["https://vertexaisearch.cloud.google.com/r/1"]


def test_search_falls_back_to_the_second_model_on_a_busy_reply():
    models = []

    def handler(request: httpx.Request) -> httpx.Response:
        if "generateContent" in str(request.url):
            models.append(str(request.url).rsplit("/", 1)[1])
            if "3.5-flash-lite" in str(request.url):
                return httpx.Response(503, json={"error": {"message": "high demand"}})
            return httpx.Response(200, json=GROUNDED)
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"text": "disputed"}'}}]})

    result = make(handler).search_json(prompt="check", schema=SCHEMA)
    assert result.ok and result.engine == "gemini-3.8-flash"
    assert models == ["gemini-3.5-flash-lite:generateContent", "gemini-3.8-flash:generateContent"]


def test_search_judge_failing_the_schema_is_a_bad_reply():
    def handler(request: httpx.Request) -> httpx.Response:
        if "generateContent" in str(request.url):
            return httpx.Response(200, json=GROUNDED)
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"wrong": 1}'}}]})

    result = make(handler).search_json(prompt="check", schema=SCHEMA)
    assert not result.ok and result.error["code"] == "bad_reply"


def test_image_returns_the_inline_bytes():
    raw = b"\xff\xd8\xff\xe0jpeg"

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url).endswith("/models/gemini-3.1-flash-lite-image:generateContent")
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [
            {"inlineData": {"mimeType": "image/jpeg", "data": base64.b64encode(raw).decode()}}]}}]})

    assert make(handler).generate_image("a map") == raw


def test_no_gemini_key_fails_without_requests():
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no call without a key")

    client = make(handler, env={"HALO_GEMINI": "text,search,image"})
    assert not client.complete_json(prompt="p", schema=SCHEMA).ok
    assert client.search_json(prompt="p", schema=SCHEMA).error["code"] == "missing_key"
    assert client.generate_image("a map") is None


def test_fakes_win_over_the_provider_switch():
    urls = []

    def handler(request: httpx.Request) -> httpx.Response:
        urls.append(str(request.url))
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"text": "ok"}'}}]})

    make(handler, env={**ENV, "HALO_FAKES": "1", "BASETEN_API_KEY": "k"}).complete_json(prompt="p", schema=SCHEMA)
    assert urls[0].startswith("http://127.0.0.1:18777/")


MIX = {"HALO_GEMINI": "backup,search", "GEMINI_API_KEY": "test-gemini", "META_API_KEY": "test-meta"}


def test_backup_tries_meta_first_and_keeps_its_cache_key():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.url.host, json.loads(request.content)))
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"text": "ok"}'}}]})

    result = make(handler, env=MIX).complete_json(prompt="p", schema=SCHEMA, prompt_cache_key="halo-x")
    host, body = seen[0]
    assert len(seen) == 1 and host == "api.meta.ai"
    assert body["model"] == "muse-spark-1.3-contributor" and body["reasoning_effort"] == "minimal"
    assert body["prompt_cache_key"] == "halo-x"
    assert result.ok and result.engine == "muse-spark-1.3-contributor"


def test_backup_moves_to_gemini_when_meta_fails():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.url.host, json.loads(request.content)))
        if request.url.host == "api.meta.ai":
            return httpx.Response(503, json={"error": {"code": "service_overloaded"}})
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"text": "ok"}'}}]})

    client = make(handler, env=MIX)
    result = client.complete_json(prompt="p", schema=SCHEMA, prompt_cache_key="halo-x")
    host, body = seen[-1]
    assert result.ok and result.engine == "gemini-3.1-flash-lite"
    assert host == "generativelanguage.googleapis.com" and "prompt_cache_key" not in body
    assert client.health() == {"engine": "gemini-3.1-flash-lite", "failover": True}


def test_search_only_judges_on_gemini_while_text_stays_on_meta():
    hosts = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method != "HEAD":  # HEADs only resolve the source links
            hosts.append(request.url.host)
        if "generateContent" in str(request.url):
            return httpx.Response(200, json=GROUNDED)
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"text": "disputed"}'}}]})

    env = {"HALO_GEMINI": "search", "GEMINI_API_KEY": "test-gemini", "META_API_KEY": "test-meta"}
    client = make(handler, env=env)
    assert client.search_json(prompt="Claim: <said>Egypt has 50 million</said>", schema=SCHEMA).ok
    assert hosts == ["generativelanguage.googleapis.com"] * 2
    client.complete_json(prompt="p", schema=SCHEMA)
    assert hosts[-1] == "api.meta.ai"


def test_search_looks_up_the_bare_claim():
    asks = []

    def handler(request: httpx.Request) -> httpx.Response:
        if "generateContent" in str(request.url):
            asks.append(json.loads(request.content)["contents"][0]["parts"][0]["text"])
            return httpx.Response(200, json=GROUNDED)
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"text": "x"}'}}]})

    make(handler).search_json(prompt="Rules...\nClaim: <said>Qatar has 12 million</said>\nSpoken: ...",
                              schema=SCHEMA)
    assert asks[0].endswith(": Qatar has 12 million")


def test_image_stays_on_meta_unless_listed():
    urls = []

    def handler(request: httpx.Request) -> httpx.Response:
        urls.append(str(request.url))
        return httpx.Response(500)

    make(handler, env=MIX).generate_image("a map")
    assert urls == ["https://api.meta.ai/v1/responses"]
