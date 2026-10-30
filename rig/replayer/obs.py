"""Fixture Capture: an OBS desktop+mic WAV pair becomes a fixture dir
(tab.pcm / mic.pcm + starter scripts) without hand-editing."""

from __future__ import annotations

import json
import wave
from pathlib import Path


def _pcm(wav_path: Path) -> tuple[bytes, int]:
    with wave.open(str(wav_path), "rb") as w:
        frames = w.readframes(w.getnframes())
        return frames, int(w.getnframes() * 1000 / w.getframerate())


def convert_obs_pair(desktop_wav: str | Path, mic_wav: str | Path, out_dir: str | Path) -> Path:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    tab, tab_ms = _pcm(Path(desktop_wav))
    mic, mic_ms = _pcm(Path(mic_wav))
    (out / "tab.pcm").write_bytes(tab)
    (out / "mic.pcm").write_bytes(mic)
    starter = [
        {"stream": "tab", "speaker": "A", "text": "", "lang": "en", "ts_start_ms": 0, "ts_end_ms": tab_ms},
        {"stream": "mic", "speaker": "you", "text": "", "lang": "en", "ts_start_ms": 0, "ts_end_ms": mic_ms},
    ]
    (out / "asr_script.jsonl").write_text(
        "\n".join(json.dumps(r) for r in starter), encoding="utf-8")
    (out / "llm_script.jsonl").write_text("", encoding="utf-8")
    (out / "meta.json").write_text(json.dumps(
        {"t0_ms": 0, "tiles": [], "roles": {}, "source": "obs-converter"}), encoding="utf-8")
    return out
