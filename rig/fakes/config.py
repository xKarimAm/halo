"""Env seam: HALO_FAKES switches engine endpoints to the fakes.

With the flag off the returned config is the real one, byte-identical: the
backend holds no test-only branches, only this endpoint swap (Done case 8).
HALO_FAKE_PORT moves the whole fake rig off 18777 so parallel runs (and a
busy dev machine) never share one fake server; unset keeps the default.
"""

from __future__ import annotations

import os
from collections.abc import Mapping

REAL = {
    "asr_url": "wss://api.meta.ai/v1/asr/realtime",  # /v1/voice/realtime answers 401 (live check)
    "llm_url": "https://inference.baseten.co/v1",
    "llm_model": "spark-open",
}
FAKE_PORT_DEFAULT = "18777"
FAKE_MODEL = "spark-open"


def _fake(env: Mapping[str, str]) -> dict:
    port = env.get("HALO_FAKE_PORT", FAKE_PORT_DEFAULT)
    return {
        "asr_url": f"ws://127.0.0.1:{port}/v1/voice/realtime",
        "llm_url": f"http://127.0.0.1:{port}/v1",
        "llm_model": FAKE_MODEL,
    }


def fakes_enabled(env: Mapping[str, str] | None = None) -> bool:
    env = os.environ if env is None else env
    return env.get("HALO_FAKES") == "1" or "fake" in env.get("HALO_ENGINES", "").split(",")


def engine_config(env: Mapping[str, str] | None = None) -> dict:
    env = os.environ if env is None else env
    return _fake(env) if fakes_enabled(env) else dict(REAL)
