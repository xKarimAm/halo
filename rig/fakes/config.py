"""Env seam: HALO_FAKES switches engine endpoints to the fakes.

With the flag off the returned config is the real one, byte-identical: the
backend holds no test-only branches, only this endpoint swap (Done case 8).
"""

from __future__ import annotations

import os
from collections.abc import Mapping

REAL = {
    "asr_url": "wss://api.meta.ai/v1/asr/realtime",  # /v1/voice/realtime answers 401 (live check)
    "llm_url": "https://inference.baseten.co/v1",
    "llm_model": "spark-open",
}
FAKE = {
    "asr_url": "ws://127.0.0.1:18777/v1/voice/realtime",
    "llm_url": "http://127.0.0.1:18777/v1",
    "llm_model": "spark-open",
}


def fakes_enabled(env: Mapping[str, str] | None = None) -> bool:
    env = os.environ if env is None else env
    return env.get("HALO_FAKES") == "1" or "fake" in env.get("HALO_ENGINES", "").split(",")


def engine_config(env: Mapping[str, str] | None = None) -> dict:
    return dict(FAKE if fakes_enabled(env) else REAL)
