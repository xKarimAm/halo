"""Fixture script loaders. Format owned by rig/replayer (issue #3); assumed
shape documented in STATE.md until replayer confirms it."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AsrTurn:
    stream: str
    speaker: str
    text: str
    lang: str
    ts_start_ms: int
    ts_end_ms: int


@dataclass(frozen=True)
class LlmReply:
    match: str
    response: dict


def _lines(path: str | Path) -> list[dict]:
    text = Path(path).read_text(encoding="utf-8")
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def load_asr_script(path: str | Path) -> list[AsrTurn]:
    return [
        AsrTurn(
            stream=row.get("stream", "tab"),
            speaker=row["speaker"],
            text=row["text"],
            lang=row["lang"],
            ts_start_ms=int(row["ts_start_ms"]),
            ts_end_ms=int(row["ts_end_ms"]),
        )
        for row in _lines(path)
    ]


def load_llm_script(path: str | Path) -> list[LlmReply]:
    return [LlmReply(match=row.get("match", ""), response=row["response"]) for row in _lines(path)]
