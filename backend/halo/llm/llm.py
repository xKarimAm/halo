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
- 400/404 are never retried. On the PRIMARY they fail over (a host may
  reject a field or the model id); on the contributor they are typed
  failures. A 401 or a missing key on the PRIMARY also fails over (no
  same-engine retry for a deterministic 401); each is logged once. Keys come from the
  environment (never logged); missing keys fail the call, they never raise.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import random
import re
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

# HALO_GEMINI=<parts>: the listed parts go to Google with GEMINI_API_KEY (branch
# feat/gemini-provider; main stays Meta-only, DECISIONS section 3). Parts: text (both
# slots), backup (Meta contributor first, Gemini when it fails), search (fact check),
# image, speech (app.py). Karim's mix 2026-11-13: backup,search. Models from
# the 2026-11-13 probe: 3.1-flash-lite passed all 9 schemas in 0.8-4 s and is the
# cheapest text model open to new keys (2.5-flash-lite: 404 for new users);
# 3.8-flash is the failover (3.5-flash-lite gave 503s to half a burst).
GEMINI_COMPAT_URL = "https://generativelanguage.googleapis.com/v1beta/openai"
GEMINI_NATIVE_URL = "https://generativelanguage.googleapis.com/v1beta/models/"
GEMINI_MODELS = {PRIMARY_ENGINE: "gemini-3.1-flash-lite", FAILOVER_ENGINE: "gemini-3.8-flash"}
# Fact check: look-up on 3.5-flash-lite (1.2-1.4 s, 2-4 sources), 3.8-flash if busy.
GEMINI_SEARCH_MODELS = ("gemini-3.5-flash-lite", "gemini-3.8-flash")
GEMINI_IMAGE_MODEL = "gemini-3.1-flash-lite-image"

# List price per 1M tokens (input, cached input, output) for the spend estimate
# in health.json (Karim 2026-11-04). Spark Open: Baseten's model page; the
# contributor: DECISIONS line 50; Gemini: aistudio.google.com/docs/pricing
# (2026-11-13; 3.8-flash doubles on 2027-01-01). The billing page is the truth.
PRICES_PER_M: dict[str, tuple[float, float, float]] = {
    PRIMARY_ENGINE: (1.25, 0.15, 4.25),
    FAILOVER_ENGINE: (0.10, 0.002, 0.20),
    "gemini-3.1-flash-lite": (0.25, 0.025, 1.50),
    "gemini-3.8-flash": (0.75, 0.075, 3.75),
    "gemini-3.5-flash-lite": (0.30, 0.03, 2.50),
}

# The rig's FakeLLM HTTP server stands in for both engines wire-compatibly.
# HALO_FAKE_PORT moves the whole fake rig off 18777 so parallel runs (and a
# busy dev machine) do not share one fake server; unset keeps the default.
FAKE_BASE_URL = "http://127.0.0.1:18777/v1"


def _fake_base_url(env: Mapping[str, str]) -> str:
    return f"http://127.0.0.1:{env.get('HALO_FAKE_PORT', '18777')}/v1"

CALL_TIMEOUT_S = 4.0
# ponytail: the contributor as first choice (backup mode) runs 3-4.5 s, so 4 s would
# send most calls to Gemini; 6 s keeps them on Meta. Lower it if live points lag.
META_FIRST_TIMEOUT_S = 6.0
# ponytail: the contributor is the last resort; measured live at ~3-4.5 s per
# Insight call, so a 4 s cut drops most points. Late beats none.
FAILOVER_TIMEOUT_S = 10.0
IMAGE_MODEL = "muse-image-1.0"
IMAGE_TIMEOUT_S = 90.0  # measured 21 s; the viewer pressed a button and sees it drawing
SEARCH_TIMEOUT_S = 25.0  # measured 3-14 s; off the live path, so a slow search only arrives later
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
        failover_timeout_s: float = FAILOVER_TIMEOUT_S,
        cooldown_s: float = COOLDOWN_S,
        env: Mapping[str, str] | None = None,
    ) -> None:
        environ = os.environ if env is None else env
        self._fakes = _fakes_on(environ)
        # The fakes win, so CI and the thin run stay keyless and offline.
        self._gem = set() if self._fakes else {
            p.strip() for p in environ.get("HALO_GEMINI", "").split(",") if p.strip()}
        self._gemini_key = environ.get("GEMINI_API_KEY")
        self._meta_key = meta_key if meta_key is not None else environ.get("META_API_KEY")
        self._slot: dict[str, dict[str, str]] = {}  # per-slot overrides (Gemini parts)
        # The primary host (Baseten by default; Modal or a local server) is
        # set from env. Blank or unset keeps the default.
        primary = ENGINES[PRIMARY_ENGINE]
        base_url = environ.get("HALO_PRIMARY_BASE_URL")
        self._primary = {
            "base_url": base_url or primary["base_url"],
            "model": environ.get("HALO_PRIMARY_MODEL") or primary["model"],
            # A custom host with no key var gets no key (fails over), never
            # the Baseten key.
            "key_var": environ.get("HALO_PRIMARY_KEY_VAR") or ("" if base_url else primary["key_var"]),
        }
        key_var = self._primary["key_var"]
        self._keys = {
            PRIMARY_ENGINE: baseten_key if baseten_key is not None
            else environ.get(key_var) if key_var else None,
            FAILOVER_ENGINE: meta_key if meta_key is not None else environ.get("META_API_KEY"),
        }
        self._names = {e: e for e in ENGINES}  # what results, health and usage call each engine
        gemini = {"base_url": GEMINI_COMPAT_URL, "key_var": "GEMINI_API_KEY", "reasoning_effort": "low"}
        if "text" in self._gem:
            self._slot = {e: {**gemini, "model": GEMINI_MODELS[e]} for e in ENGINES}
            self._keys = dict.fromkeys(ENGINES, self._gemini_key)
            self._names = dict(GEMINI_MODELS)
        elif "backup" in self._gem:
            self._slot = {PRIMARY_ENGINE: dict(ENGINES[FAILOVER_ENGINE]),
                          FAILOVER_ENGINE: {**gemini, "model": GEMINI_MODELS[PRIMARY_ENGINE]}}
            self._keys = {PRIMARY_ENGINE: self._keys[FAILOVER_ENGINE], FAILOVER_ENGINE: self._gemini_key}
            self._names = {PRIMARY_ENGINE: FAILOVER_ENGINE, FAILOVER_ENGINE: GEMINI_MODELS[PRIMARY_ENGINE]}
            call_timeout_s = META_FIRST_TIMEOUT_S
        self._fake_base = _fake_base_url(environ)
        self._key_warned: set[str] = set()
        self._clock: Clock = clock or time.monotonic
        self._sleep = sleep or time.sleep
        self._timeout = call_timeout_s
        self._failover_timeout = failover_timeout_s
        self._cooldown = cooldown_s
        # Live 2026-11-04: httpx's 5 s keep-alive made every call after a pause
        # redo TLS (3.9-4.5 s vs ~2 s) and time out. ponytail: 120 s measured
        # fine at 65 s idle; if Baseten closes sooner, the call reconnects.
        self._http = httpx.Client(transport=transport, timeout=httpx.Timeout(call_timeout_s),
                                  limits=httpx.Limits(keepalive_expiry=120))
        self._primary_down_until = 0.0
        self._last_engine = PRIMARY_ENGINE if self._keys[PRIMARY_ENGINE] else FAILOVER_ENGINE
        self._usage = {n: {"calls": 0, "in": 0, "cached": 0, "out": 0} for n in self._names.values()}

    def close(self) -> None:
        self._http.close()

    def _config(self, engine: str) -> dict[str, str]:
        cfg = dict(ENGINES[engine])
        if engine == PRIMARY_ENGINE:
            cfg.update(self._primary)
        cfg.update(self._slot.get(engine, {}))
        if self._fakes:
            cfg["base_url"] = self._fake_base
        return cfg

    def health(self) -> dict[str, Any]:
        """Health callable for `bus.register_health("llm", client.health)`."""
        return {
            "engine": self._names[self._last_engine],
            "failover": self._clock() < self._primary_down_until,
        }

    def usage(self) -> dict[str, Any]:
        """Tokens and estimated USD per engine since this backend started
        (health module `llm_spend`). A call past its time budget gets no reply,
        so its tokens are not counted here, though the provider may bill them."""
        out: dict[str, Any] = {}
        for engine, u in self._usage.items():
            p_in, p_cached, p_out = PRICES_PER_M[engine]
            usd = ((u["in"] - u["cached"]) * p_in + u["cached"] * p_cached + u["out"] * p_out) / 1e6
            out[engine] = {**u, "usd": round(usd, 4)}
        out["usd_total"] = round(sum(v["usd"] for v in out.values()), 4)
        return out

    def _count(self, engine: str, response: httpx.Response) -> None:
        try:
            u = response.json().get("usage") or response.json().get("usageMetadata") or {}
        except (ValueError, AttributeError):
            return
        tally = self._usage.setdefault(self._names.get(engine, engine),
                                       {"calls": 0, "in": 0, "cached": 0, "out": 0})
        tally["calls"] += 1
        tally["in"] += int(u.get("prompt_tokens") or u.get("input_tokens") or u.get("promptTokenCount") or 0)
        tally["cached"] += int((u.get("prompt_tokens_details") or {}).get("cached_tokens")
                               or u.get("cachedContentTokenCount") or 0)
        tally["out"] += (int(u.get("completion_tokens") or u.get("output_tokens")
                             or u.get("candidatesTokenCount") or 0) + int(u.get("thoughtsTokenCount") or 0))

    def _named(self, result: LLMResult) -> LLMResult:
        result.engine = self._names.get(result.engine, result.engine)
        return result

    def complete_json(
        self,
        *,
        prompt: str,
        schema: dict[str, Any],
        schema_name: str = "halo.result",
        system: str | None = None,
        prompt_cache_key: str | None = None,
        timeout_s: float | None = None,
    ) -> LLMResult:
        """One validated JSON completion, with retry + per-call failover.
        `timeout_s` replaces the live budgets for a call nobody is waiting on."""
        return self._named(self._complete_json(
            prompt=prompt, schema=schema, schema_name=schema_name, system=system,
            prompt_cache_key=prompt_cache_key, timeout_s=timeout_s))

    def _complete_json(self, *, prompt: str, schema: dict[str, Any], schema_name: str,
                       system: str | None, prompt_cache_key: str | None,
                       timeout_s: float | None) -> LLMResult:
        engines = [PRIMARY_ENGINE, FAILOVER_ENGINE]
        # No Spark Open key is a supported setup (README): the contributor is the
        # engine by design, not a failover, so the primary is not even tried.
        if not self._keys[PRIMARY_ENGINE] and PRIMARY_ENGINE not in self._key_warned:
            self._key_warned.add(PRIMARY_ENGINE)
            log.warning("llm %s has no key in %s; every call runs on %s", PRIMARY_ENGINE,
                        self._primary["key_var"] or "HALO_PRIMARY_KEY_VAR (unset)", FAILOVER_ENGINE)
        if not self._keys[PRIMARY_ENGINE] or self._clock() < self._primary_down_until:
            engines = [FAILOVER_ENGINE]
        last = LLMResult(ok=False, engine=engines[-1],
                         error={"code": "engine_error", "message": "no engine attempted"})
        for i, engine in enumerate(engines):
            outcome = self._call_engine(
                engine, prompt=prompt, schema=schema,
                schema_name=schema_name, system=system,
                prompt_cache_key=prompt_cache_key, timeout_s=timeout_s,
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
                    detail = outcome.result.error["message"] if outcome.result.error else ""
                    log.warning("llm primary %s failed (%s) on %s: %s; failing over to %s for %.0fs",
                                self._names[engine], code, schema_name, detail, self._names[FAILOVER_ENGINE], self._cooldown)
            if i == len(engines) - 1:
                return last
        return last

    def search_json(
        self,
        *,
        prompt: str,
        schema: dict[str, Any],
        schema_name: str = "halo.search",
    ) -> LLMResult:
        """One web-searched JSON reply (Meta Responses API, web_search tool).
        Data is the reply plus `sources`, the URLs the search returned. One try,
        no failover: only Meta has the tool, and a missed check costs nothing."""
        if "search" in self._gem:
            return self._gemini_search(prompt, schema)
        engine = FAILOVER_ENGINE

        def fail(code: str, message: str) -> LLMResult:
            return LLMResult(ok=False, engine=engine, error={"code": code, "message": message})

        key = self._meta_key  # Meta's own tool, whatever the text slots hold
        if not key:
            return fail("missing_key", f"{engine}: no key")
        cfg = {**ENGINES[engine], "base_url": self._meta_base()}
        try:
            response = self._http.post(
                cfg["base_url"].rstrip("/") + "/responses",
                headers={"Authorization": f"Bearer {key}"},
                json={
                    "model": cfg["model"],
                    "input": prompt,
                    "tools": [{"type": "web_search"}],
                    "include": ["web_search_call.action.sources"],
                    "reasoning": {"effort": "minimal"},
                    "text": {"format": {"type": "json_schema", "name": schema_name,
                                        "schema": schema, "strict": True}},
                },
                timeout=httpx.Timeout(SEARCH_TIMEOUT_S),
            )
        except httpx.HTTPError as exc:
            return fail("connection_error", f"{engine}: {exc!r}"[:200])
        if response.status_code != 200:
            return fail("engine_error", f"{engine}: HTTP {response.status_code} {_excerpt(response)}")
        self._count(engine, response)
        data = _read_search(response, schema)
        if data is None:
            return fail("bad_reply", f"{engine}: search reply failed the schema")
        return LLMResult(ok=True, engine=engine, data=data)

    def generate_image(self, prompt: str) -> bytes | None:
        """One PNG from Muse Image, or None. Its price is per image, so it is
        not in `usage()`: callers ask only when the viewer does."""
        if "image" in self._gem:
            return self._gemini_image(prompt, self._gemini_key) if self._gemini_key else None
        key = self._meta_key
        if not key:
            return None
        try:
            response = self._http.post(
                self._meta_base() + "/responses",
                headers={"Authorization": f"Bearer {key}"},
                json={"model": IMAGE_MODEL, "input": prompt,
                      "tools": [{"type": "image_generation", "output_format": "png"}]},
                timeout=httpx.Timeout(IMAGE_TIMEOUT_S),
            )
            calls = [i for i in response.json().get("output", []) if i.get("type") == "image_generation_call"]
            return base64.b64decode(calls[-1]["result"], validate=True)
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError, AttributeError) as exc:
            log.warning("muse image call failed: %r", exc)
            return None

    def _meta_base(self) -> str:
        """The Meta API host for its own tools (web search, image), whatever the text slots hold."""
        return (self._fake_base if self._fakes else ENGINES[FAILOVER_ENGINE]["base_url"]).rstrip("/")

    def _gemini_search(self, prompt: str, schema: dict[str, Any]) -> LLMResult:
        """Look up, then judge. Measured 2026-11-13: asking Gemini for JSON (schema or
        words) stops it searching, so the verdict would carry no sources and fact_check
        drops it; a plain look-up question searched 10 of 10 claims (Arabic too)."""
        engine = GEMINI_SEARCH_MODELS[0]

        def fail(code: str, message: str) -> LLMResult:
            return LLMResult(ok=False, engine=engine, error={"code": code, "message": message})

        key = self._gemini_key
        if not key:
            return fail("missing_key", f"{engine}: no key in GEMINI_API_KEY")
        # Only the bare claim reliably triggers a search (10/10); the whole task prompt
        # skipped it on 4 of 7 public claims. ponytail: reads fact_check's <said> tag,
        # falling back to the whole prompt.
        claim = re.search(r"Claim: <said>(.*?)</said>", prompt, re.DOTALL)
        ask = ("Look this up on the web and say what reliable sources report, in two sentences: "
               + (claim.group(1) if claim else prompt))
        for engine in GEMINI_SEARCH_MODELS:  # 3.5-flash-lite answered 503 to half a burst
            try:
                response = self._http.post(
                    GEMINI_NATIVE_URL + engine + ":generateContent", headers={"x-goog-api-key": key},
                    json={"contents": [{"parts": [{"text": ask}]}], "tools": [{"google_search": {}}]},
                    timeout=httpx.Timeout(SEARCH_TIMEOUT_S))
            except httpx.HTTPError as exc:
                return fail("connection_error", f"{engine}: {exc!r}"[:200])
            if response.status_code == 200:
                break
        if response.status_code != 200:
            return fail("engine_error", f"{engine}: HTTP {response.status_code} {_excerpt(response)}")
        self._count(engine, response)
        try:
            candidate = response.json()["candidates"][0]
            found = "".join(p.get("text", "") for p in candidate["content"]["parts"])
            chunks = (candidate.get("groundingMetadata") or {}).get("groundingChunks") or []
            # Google's vertexaisearch redirect links; they open the source page.
            sources = list(dict.fromkeys(u for c in chunks if (u := (c.get("web") or {}).get("uri"))))
        except (ValueError, KeyError, IndexError, TypeError, AttributeError):
            return fail("bad_reply", f"{engine}: unreadable search reply")
        # The verdict stays on Gemini even when the text slots are Meta (fact check alone).
        judge = GEMINI_MODELS[PRIMARY_ENGINE]
        body = {"model": judge, "reasoning_effort": "low",
                "messages": [{"role": "user", "content": f"{prompt}\nWhat web sources report: <said>{found}</said>"}],
                "response_format": {"type": "json_schema", "json_schema": {"name": "halo.search", "schema": schema}}}
        judged = self._post_once(judge, GEMINI_COMPAT_URL, key, body, schema, SEARCH_TIMEOUT_S).result
        if not judged.ok or judged.data is None:
            return fail("bad_reply", f"{engine}: verdict failed the schema")
        return LLMResult(ok=True, engine=engine, data={**judged.data, "sources": sources})

    def _gemini_image(self, prompt: str, key: str) -> bytes | None:
        # ponytail: Gemini returns JPEG and has no PNG option (imageConfig.outputMimeType
        # is a 400); browsers sniff it under the recap's image/png type. Convert if a
        # strict consumer ever appears.
        try:
            response = self._http.post(
                GEMINI_NATIVE_URL + GEMINI_IMAGE_MODEL + ":generateContent",
                headers={"x-goog-api-key": key},
                json={"contents": [{"parts": [{"text": prompt}]}],
                      "generationConfig": {"responseModalities": ["IMAGE"]}},
                timeout=httpx.Timeout(IMAGE_TIMEOUT_S),
            )
            parts = response.json()["candidates"][0]["content"]["parts"]
            data = [p["inlineData"]["data"] for p in parts if "inlineData" in p]
            return base64.b64decode(data[-1], validate=True)
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError, AttributeError) as exc:
            log.warning("gemini image call failed: %r", exc)
            return None

    def _call_engine(
        self,
        engine: str,
        *,
        prompt: str,
        schema: dict[str, Any],
        schema_name: str,
        system: str | None,
        prompt_cache_key: str | None,
        timeout_s: float | None = None,
    ) -> _Outcome:
        cfg = self._config(engine)
        key = self._keys[engine]
        if not key:
            if engine not in self._key_warned:
                self._key_warned.add(engine)
                log.warning("llm %s has no key in %s; failing over", engine,
                            cfg["key_var"] or "HALO_PRIMARY_KEY_VAR (unset)")
            return _Outcome(
                LLMResult(ok=False, engine=engine,
                          error={"code": "missing_key",
                                 "message": f"no key in {cfg['key_var'] or 'HALO_PRIMARY_KEY_VAR (unset)'}"}),
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
        if prompt_cache_key is not None and cfg["base_url"] != GEMINI_COMPAT_URL:  # Gemini: HTTP 400
            body["prompt_cache_key"] = prompt_cache_key

        outcome = self._post_once(engine, cfg["base_url"], key, body, schema, timeout_s)
        if outcome.result.ok or not outcome.failover:
            return outcome
        if outcome.result.error is not None and outcome.result.error["code"] in (
                "timeout", "unauthorized", "bad_request", "not_found"):
            # A slow engine stays slow and a rejected key or request stays
            # rejected: fail over at once, no same-engine retry.
            return outcome
        if outcome.result.error is not None and outcome.result.error["code"] != "invalid_response":
            self._sleep(_backoff())
        # Retry once on the same engine; a second failure fails over.
        return self._post_once(engine, cfg["base_url"], key, body, schema, timeout_s)

    def _post_once(
        self,
        engine: str,
        base_url: str,
        key: str,
        body: dict[str, Any],
        schema: dict[str, Any],
        timeout_s: float | None = None,
    ) -> _Outcome:
        def fail(code: str, message: str, *, failover: bool) -> _Outcome:
            return _Outcome(LLMResult(ok=False, engine=engine,
                                      error={"code": code, "message": message}),
                            failover=failover)

        budget = timeout_s or (self._timeout if engine == PRIMARY_ENGINE else self._failover_timeout)
        start = self._clock()
        try:
            response = self._http.post(
                base_url.rstrip("/") + "/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json=body,
                timeout=httpx.Timeout(budget),
            )
        except httpx.TimeoutException:
            return fail("timeout", f"{engine} exceeded {budget:g}s", failover=True)
        except httpx.HTTPError as exc:
            return fail("connection_error", f"{engine}: {exc!r}"[:200], failover=True)

        status = response.status_code
        if status == 429:
            return fail("rate_limited", f"{engine}: HTTP 429", failover=True)
        if status >= 500:
            return fail("server_error", f"{engine}: HTTP {status}", failover=True)
        # A primary host that rejects a field (reasoning_effort, json_schema)
        # or the model id fails over; the contributor's 400/404 are final.
        primary = engine == PRIMARY_ENGINE
        if status == 400:
            return fail("bad_request", f"{engine}: HTTP 400 {_excerpt(response)}", failover=primary)
        if status == 401:
            return fail("unauthorized", f"{engine}: HTTP 401 {_excerpt(response)}", failover=True)
        if status == 404:
            return fail("not_found", f"{engine}: HTTP 404 {_excerpt(response)}", failover=primary)
        if status != 200:
            return fail("engine_error", f"{engine}: HTTP {status}", failover=True)

        self._count(engine, response)
        data = _read_content(response, schema)
        if data is None:
            return fail("invalid_response", f"{engine}: reply failed schema", failover=True)
        elapsed = self._clock() - start
        if elapsed > budget:
            # Valid but past the per-call budget: discard, fail over.
            return fail("timeout", f"{engine} replied in {elapsed:.1f}s, past {budget:g}s", failover=True)
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


def _read_search(response: httpx.Response, schema: dict[str, Any]) -> dict[str, Any] | None:
    """The validated last message of a Responses reply, plus the searched URLs.
    Earlier messages are the model narrating its search, not the answer."""
    try:
        output = response.json()["output"]
        text = [i for i in output if i["type"] == "message"][-1]["content"][-1]["text"]
        data = json.loads(text)
        if not isinstance(data, dict) or list(Draft202012Validator(schema).iter_errors(data)):
            return None
        urls = [s.get("url") for i in output if i["type"] == "web_search_call"
                for s in (i.get("action") or {}).get("sources") or [] if isinstance(s, dict)]
    except (ValueError, KeyError, IndexError, TypeError, AttributeError):
        return None
    data["sources"] = list(dict.fromkeys(u for u in urls if u))
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
