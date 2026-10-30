"""Synthetic fixture generator: deterministic, no real audio/faces.
Run: `uv run python -m rig.replayer.generator` (rewrites fixtures/synthetic)."""

from __future__ import annotations

import json
from pathlib import Path

T0 = 1_700_000_000_000
MEETING = "22222222-2222-4222-8222-222222222222"
OUT = Path(__file__).parent / "fixtures" / "synthetic"


def _env(n: int, type_: str, offset: int, data: dict) -> dict:
    return {
        "specversion": "1.0",
        "id": f"00000000-0000-4000-8000-{n:012d}",
        "type": type_,
        "source": "halo/replayer",
        "time": "2026-10-31T09:00:00Z",
        "meetingid": MEETING,
        "datacontenttype": "application/json",
        "ts_ms": offset,
        "data": data,
    }


def generate(out: Path = OUT) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    (out / "meta.json").write_text(json.dumps({
        "t0_ms": T0,
        "tiles": [{"tile_id": "tile-1", "name": "Karim Amer", "is_self": True}],
        "roles": {"Karim Amer": "host"},
    }), encoding="utf-8")
    envelopes = [
        _env(1, "meeting.started", 0, {
            "meeting_id": MEETING, "platform": "meet", "meeting_code": "abc-defg-hij",
            "t0_ms": T0, "self_name": "Karim Amer"}),
        _env(2, "tiles.snapshot", 100, {"tiles": [{
            "tile_id": "tile-1", "name": "Karim Amer", "is_self": True,
            "rect": [0, 0, 400, 225], "video_w": 640, "video_h": 360,
            "fit": "cover", "captions_rect": None}]}),
        _env(3, "speaker.active", 200, {"tile_id": "tile-1", "speaking": True, "ts_ms": T0 + 200}),
        _env(4, "transcript.final", 1000, {
            "turn_id": "00000030-0000-4000-8000-000000000030", "stream": "tab", "speaker": "A",
            "text": "Launch moves to Nov 12.", "lang": "en",
            "ts_start_ms": T0 + 1000, "ts_end_ms": T0 + 1900}),
        _env(5, "transcript.final", 2000, {
            "turn_id": "00000031-0000-4000-8000-000000000031", "stream": "tab", "speaker": "A",
            "text": "Pricing stays at ten.", "lang": "en",
            "ts_start_ms": T0 + 2000, "ts_end_ms": T0 + 2800}),
    ]
    (out / "envelopes.jsonl").write_text(
        "\n".join(json.dumps(e) for e in envelopes), encoding="utf-8")
    expected = [
        {"type": "meeting.started", "tile_id": None, "ts_ms": T0},
        {"type": "transcript.final", "tile_id": None, "ts_ms": T0 + 1000, "text": "Launch moves to Nov 12"},
        {"type": "transcript.final", "tile_id": None, "ts_ms": T0 + 2000, "text": "Pricing stays at ten"},
    ]
    (out / "expected.jsonl").write_text(
        "\n".join(json.dumps(e) for e in expected), encoding="utf-8")
    (out / "asr_script.jsonl").write_text("\n".join(json.dumps(r) for r in [
        {"stream": "tab", "speaker": "A", "text": "Launch moves to Nov 12.", "lang": "en",
         "ts_start_ms": 1000, "ts_end_ms": 1900},
    ]), encoding="utf-8")
    (out / "llm_script.jsonl").write_text(json.dumps(
        {"match": "Launch moves", "response": {"kind": "decision", "text": "Launch moves to Nov 12"}}),
        encoding="utf-8")
    (out / "faces.jsonl").write_text(json.dumps(
        {"tile_id": "tile-1", "box": [0.38, 0.18, 0.24, 0.42]}), encoding="utf-8")
    (out / "tab.pcm").write_bytes(b"\x00\x00" * 1600 * 30)  # 3 s silence
    (out / "mic.pcm").write_bytes(b"\x00\x00" * 1600 * 10)  # 1 s silence
    return out


if __name__ == "__main__":
    print(generate())
