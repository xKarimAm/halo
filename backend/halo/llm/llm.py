"""The one shared model client (DECISIONS sections 3+5, `.agents/skills/meta-model-api/llm.md`).

OpenAI-compatible chat completions against Baseten (Spark Open, the default)
with per-call failover to the Meta API (`muse-spark-1.3-contributor`).
Every result carries its `engine`; failures are typed dicts, never raised.

Rules implemented here:
- Spark Open requests always send `reasoning_effort: "low"`; contributor
  requests send `"minimal"`. Only `message.content` is read.
- `response_format` json_schema is always sent, but Baseten does not enforce
  it, so every reply is validated locally against the caller's schema.
- One same-engine retry for fast failures (429/5xx/connection errors with
  backoff + jitter, invalid JSON without waiting); timeouts fail over at
  once. A second failure fails the call over to the contributor model.
- A failover demotes Spark Open for 30 s; afterwards the next call tries it
  again. Each HTTP attempt has a 4 s budget measured from request send to
  validated JSON; a slow-but-valid primary reply is discarded in favour of
  failover. Non-streaming: there are no partials to keep.
- 400/404 are typed failures, never retried nor failed over. A 401 or a
  missing key on the PRIMARY fails over to the contributor (no same-engine
  retry for a deterministic 401); either is logged once. Keys come from the
  environment (never logged); missing keys fail the call, they never raise.
"""

from __future__ import annotations

import json
import logging
import os
import random
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

import httpx
from jsonschema import Draft202012Validator  # type: ignore[import-untyped]

log = logging.getLogger("halo.llm")

PRIMARY_ENGINE = "spark-open"
FAILOVER_ENGINE = "muse-spark-1.3-contributor"

ENGINES: dict[str, dict[str, str]] = {
    PRIMARY_ENGINE: {
        "base_url": "https://inference.baseten.co/v1",
        "model": "meta-models/muse-spark-open-1026",
        "reasoning_effort": "low",
        "key_var": "BASETEN_API_KEY",
    },
    FAILOVER_ENGINE: {
        "base_url": "https://api.meta.ai/v1",
        "model": "muse-spark-1.3-contributor",
        "reasoning_effort": "minimal",
        "key_var": "META_API_KEY",
    },
}

# The rig's FakeLLM HTTP server stands in for both engines wire-compatibly.
# HALO_FAKE_PORT moves the whole fake rig off 18777 so parallel runs (and a
# busy dev machine) do not share one fake server; unset keeps the default.
FAKE_BASE_URL = "http://127.0.0.1:18777/v1"


def _fake_base_url(env: Mapping[str, str]) -> str:
    return f"http://127.0.0.1:{env.get('HALO_FAKE_PORT', '18777')}/v1"

CALL_TIMEOUT_S = 4.0
COOLDOWN_S = 30.0
BACKOFF_BASE_S = 0.5
BACKOFF_CAP_S = 4.0

Clock = Callable[[], float]


def _fakes_on(env: Mapping[str, str]) -> bool:
    return env.get("HALO_FAKES") == "1" or "fake" in env.get("HALO_ENGINES", "").split(",")


@dataclass
class LLMResult:
    ok: bool
    engine: str
    data: dict[str, Any] | None = None
    error: dict[str, str] | None = None


@dataclass
class _Outcome:
    result: LLMResult
    failover: bool  # True: the caller should try the next engine


class LLMClient:
    """Synchronous shared model client. Async callers run it in a thread."""

    def __init__(
        self,
        *,
        baseten_key: str | None = None,
        meta_key: str | None = None,
        transport: httpx.BaseTransport | None = None,
        clock: Clock | None = None,
        sleep: Callable[[float], None] | None = None,
        call_timeout_s: float = CALL_TIMEOUT_S,
        cooldown_s: float = COOLDOWN_S,
        env: Mapping[str, str] | None = None,
    ) -> None:
        environ = os.environ if env is None else env
        self._keys = {
            PRIMARY_ENGINE: baseten_key if baseten_key is not None else environ.get("BASETEN_API_KEY"),
            FAILOVER_ENGINE: meta_key if meta_key is not None else environ.get("META_API_KEY"),
        }
        self._fakes = _fakes_on(environ)
        self._fake_base = _fake_base_url(environ)
        self._key_warned: set[str] = set()
        self._clock: Clock = clock or time.monotonic
        self._sleep = sleep or time.sleep
        self._timeout = call_timeout_s
        self._cooldown = cooldown_s
        self._http = httpx.Client(transport=transport, timeout=httpx.Timeout(call_timeout_s))
        self._primary_down_until = 0.0
        self._last_engine = PRIMARY_ENGINE

    def close(self) -> None:
        self._http.close()

    def _config(self, engine: str) -> dict[str, str]:
        cfg = dict(ENGINES[engine])
        if self._fakes:
            cfg["base_url"] = self._fake_base
        return cfg

    def health(self) -> dict[str, Any]:
        """Health callable for `bus.register_health("llm", client.health)`."""
        return {
            "engine": self._last_engine,
            "failover": self._clock() < self._primary_down_until,
        }

    def complete_json(
        self,
        *,
        prompt: str,
        schema: dict[str, Any],
        schema_name: str = "halo.result",
        system: str | None = None,
        prompt_cache_key: str | None = None,
    ) -> LLMResult:
        """One validated JSON completion, with retry + per-call failover."""
        engines = [PRIMARY_ENGINE, FAILOVER_ENGINE]
        if self._clock() < self._primary_down_until:
            engines = [FAILOVER_ENGINE]
        last = LLMResult(ok=False, engine=engines[-1],
                         error={"code": "engine_error", "message": "no engine attempted"})
        for i, engine in enumerate(engines):
            outcome = self._call_engine(
                engine, prompt=prompt, schema=schema,
                schema_name=schema_name, system=system,
                prompt_cache_key=prompt_cache_key,
            )
            if outcome.result.ok:
                self._last_engine = engine
                return outcome.result
            last = outcome.result
            if not outcome.failover:
                return outcome.result
            if engine == PRIMARY_ENGINE:
                self._primary_down_until = self._clock() + self._cooldown
                code = outcome.result.error["code"] if outcome.result.error else "unknown"
                if code != "missing_key":  # already logged once where detected
                    log.warning("llm primary %s failed (%s); failing over to %s for %.0fs",
                                engine, code, FAILOVER_ENGINE, self._cooldown)
            if i == len(engines) - 1:
                return last
        return last

    def _call_engine(
        self,
        engine: str,
        *,
        prompt: str,
        schema: dict[str, Any],
        schema_name: str,
        system: str | None,
        prompt_cache_key: str | None,
    ) -> _Outcome:
        cfg = self._config(engine)
        key = self._keys[engine]
        if not key:
            if engine not in self._key_warned:
                self._key_warned.add(engine)
                log.warning("llm %s has no key in %s; failing over", engine, cfg["key_var"])
            return _Outcome(
                LLMResult(ok=False, engine=engine,
                          error={"code": "missing_key",
                                 "message": f"no key in {cfg['key_var']}"}),
                failover=True,
            )
        body: dict[str, Any] = {
            "model": cfg["model"],
            "messages": ([{"role": "system", "content": system}] if system else [])
            + [{"role": "user", "content": prompt}],
            "response_format": {"type": "json_schema",
                                "json_schema": {"name": schema_name, "schema": schema}},
            "reasoning_effort": cfg["reasoning_effort"],
        }
        if prompt_cache_key is not None:
            body["prompt_cache_key"] = prompt_cache_key

        outcome = self._post_once(engine, cfg["base_url"], key, body, schema)
        if outcome.result.ok or not outcome.failover:
            return outcome
        if outcome.result.error is not None and outcome.result.error["code"] in ("timeout", "unauthorized"):
            # A slow engine stays slow and a rejected key stays rejected:
            # fail over at once, no same-engine retry.
            return outcome
        if outcome.result.error is not None and outcome.result.error["code"] != "invalid_response":
            self._sleep(_backoff())
        # Retry once on the same engine; a second failure fails over.
        return self._post_once(engine, cfg["base_url"], key, body, schema)

    def _post_once(
        self,
        engine: str,
        base_url: str,
        key: str,
        body: dict[str, Any],
        schema: dict[str, Any],
    ) -> _Outcome:
        def fail(code: str, message: str, *, failover: bool) -> _Outcome:
            return _Outcome(LLMResult(ok=False, engine=engine,
                                      error={"code": code, "message": message}),
                            failover=failover)

        start = self._clock()
        try:
            response = self._http.post(
                base_url.rstrip("/") + "/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json=body,
            )
        except httpx.TimeoutException:
            return fail("timeout", f"{engine} exceeded {self._timeout:g}s", failover=True)
        except httpx.HTTPError as exc:
            return fail("connection_error", f"{engine}: {exc!r}"[:200], failover=True)

        status = response.status_code
        if status == 429:
            return fail("rate_limited", f"{engine}: HTTP 429", failover=True)
        if status >= 500:
            return fail("server_error", f"{engine}: HTTP {status}", failover=True)
        if status == 400:
            return fail("bad_request", f"{engine}: HTTP 400 {_excerpt(response)}", failover=False)
        if status == 401:
            return fail("unauthorized", f"{engine}: HTTP 401 {_excerpt(response)}", failover=True)
        if status == 404:
            return fail("not_found", f"{engine}: HTTP 404 {_excerpt(response)}", failover=False)
        if status != 200:
            return fail("engine_error", f"{engine}: HTTP {status}", failover=True)

        data = _read_content(response, schema)
        if data is None:
            return fail("invalid_response", f"{engine}: reply failed schema", failover=True)
        if self._clock() - start > self._timeout:
            # Valid but past the per-call budget: discard, fail over.
            return fail("timeout", f"{engine} exceeded {self._timeout:g}s", failover=True)
        return _Outcome(LLMResult(ok=True, engine=engine, data=data), failover=False)


def _excerpt(response: httpx.Response, limit: int = 200) -> str:
    try:
        return response.text[:limit]
    except (UnicodeDecodeError, LookupError):
        return ""


def _read_content(response: httpx.Response, schema: dict[str, Any]) -> dict[str, Any] | None:
    """The validated `message.content` dict, or None. Never `reasoning_content`."""
    try:
        content = response.json()["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError):
        return None
    if not isinstance(content, str):
        return None
    try:
        data = json.loads(content)
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    errors = list(Draft202012Validator(schema).iter_errors(data))
    if errors:
        return None
    return data


def _backoff() -> float:
    return min(BACKOFF_CAP_S, BACKOFF_BASE_S) * random.uniform(0.5, 1.0)


# Re-exported for tests and the composition root.
__all__ = [
    "CALL_TIMEOUT_S",
    "COOLDOWN_S",
    "FAILOVER_ENGINE",
    "PRIMARY_ENGINE",
    "LLMClient",
    "LLMResult",
]
