"""FakeLLM engine: canned OpenAI-compatible replies per fixture turn.

Matching is by prompt substring (the fixture turn's first words); fallback is
the next unplayed canned reply in order (PLAN Doubts). Knobs: per-call
latency spread and a deterministic invalid-JSON rate.
"""

from __future__ import annotations

import json
import math
import time
from collections.abc import Callable

from jsonschema import Draft202012Validator

from rig.fakes.scripts import LlmReply

MALFORMED = "{not json"


class FakeLLM:
    def __init__(
        self,
        script: list[LlmReply],
        latency_spread: dict[int, int] | None = None,
        invalid_json_rate: float = 0.0,
        sleep_fn: Callable[[int], None] | None = None,
    ):
        self._script = list(script)
        self._played: set[int] = set()
        self._latency_spread = latency_spread or {}
        self._invalid_rate = invalid_json_rate
        self._sleep = sleep_fn
        self.calls = 0
        self.last_latency_ms = 0

    def complete(self, prompt: str, schema: dict | None = None, enforce: bool = True) -> dict:
        """One chat.completion body. `enforce` = the engine enforces the
        caller's schema (Meta API): a canned reply that fails it raises.
        Without it (Spark Open on Baseten) the reply goes out unchecked."""
        idx = self._pick(prompt)
        call = self.calls
        self.calls += 1
        self.last_latency_ms = self._latency_spread.get(call, 0)
        if self._sleep is not None and self.last_latency_ms:
            self._sleep(self.last_latency_ms)
        if self._malformed(call):
            content = MALFORMED
        else:
            response = self._script[idx].response if idx is not None else {}
            if schema is not None and enforce:
                errors = [e.message for e in Draft202012Validator(schema).iter_errors(response)]
                if errors:
                    raise ValueError(f"canned reply fails caller schema: {errors}")
            content = json.dumps(response)
        # The OpenAI chat.completion shape both engines return (llm.md).
        return {
            "id": f"fake-{call}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": "",
            "choices": [{"index": 0, "finish_reason": "stop",
                         "message": {"role": "assistant", "content": content}}],
            "usage": {"prompt_tokens": len(prompt.split()), "completion_tokens": len(content.split()),
                      "total_tokens": len(prompt.split()) + len(content.split()),
                      "prompt_tokens_details": {"cached_tokens": 0}},
        }

    def _pick(self, prompt: str) -> int | None:
        for i, reply in enumerate(self._script):
            if i not in self._played and reply.match and reply.match in prompt:
                self._played.add(i)
                return i
        for i in range(len(self._script)):
            if i not in self._played:
                self._played.add(i)
                return i
        return None

    def _malformed(self, call: int) -> bool:
        if self._invalid_rate <= 0:
            return False
        return math.floor((call + 1) * self._invalid_rate) > math.floor(call * self._invalid_rate)
