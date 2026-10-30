"""Fixture dir loader. Format owned by rig/replayer (closes issue #3 for
rig/fakes): see STATE.md for the file list and script shapes."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Fixture:
    meta: dict
    envelopes: list[dict]  # full envelopes plus scheduling `ts_ms` (offset from t0)
    expected: list[dict]
    tab_pcm: bytes
    mic_pcm: bytes


def _jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def load_fixture(root: str | Path) -> Fixture:
    root = Path(root)
    return Fixture(
        meta=json.loads((root / "meta.json").read_text(encoding="utf-8")),
        envelopes=_jsonl(root / "envelopes.jsonl"),
        expected=_jsonl(root / "expected.jsonl"),
        tab_pcm=(root / "tab.pcm").read_bytes() if (root / "tab.pcm").exists() else b"",
        mic_pcm=(root / "mic.pcm").read_bytes() if (root / "mic.pcm").exists() else b"",
    )
