"""Checker tolerance for soft-cut extra finals (issue #60, dup source #62).

The transcriber's soft-cut can emit an extra `transcript.final` per turn: a
prefix piece plus the completion remainder, or (when the partial is stable at
the pause) a duplicate full-text final under a fresh turn_id. The golden
checker must skip those extras when seeking each expected turn final instead
of matching them as the NEXT turn's final (ts mismatch -> false red).
A genuinely missing or mis-timed final must still be reported.
"""

from __future__ import annotations

from rig.replayer.checker import check

T1 = "Launch moves to Nov 12 if payments QA clears"
T2 = "Beta cohort grows to twenty percent on Friday"


def _final(turn_id: str, text: str, ts_start: int) -> dict:
    return {"type": "transcript.final",
            "data": {"turn_id": turn_id, "text": text, "ts_start_ms": ts_start}}


def _expected() -> list[dict]:
    return [
        {"type": "transcript.final", "tile_id": None, "ts_ms": 1000, "text": T1},
        {"type": "transcript.final", "tile_id": None, "ts_ms": 4500, "text": T2},
    ]


def test_prefix_piece_plus_completion_is_clean() -> None:
    actual = [
        _final("piece-1", "Launch moves to Nov", 1000),
        _final("turn-1", T1, 1000),
        _final("turn-2", T2, 4500),
    ]
    assert check(_expected(), actual) == []


def test_dup_full_text_final_is_clean() -> None:
    actual = [
        _final("turn-1a", T1, 1000),
        _final("turn-1b", T1, 1000),
        _final("turn-2", T2, 4500),
    ]
    assert check(_expected(), actual) == []


def test_missing_final_still_reported() -> None:
    actual = [_final("turn-1", T1, 1000)]
    errors = check(_expected(), actual)
    assert any("missing transcript.final" in e for e in errors), errors


def test_wrong_ts_final_still_reported() -> None:
    actual = [_final("turn-1", T1, 1000), _final("turn-2", T2, 8000)]
    errors = check(_expected(), actual)
    assert errors, errors
