"""Golden asserts: a run must match expected.jsonl with ts ±300 ms, fuzzy
text (normalised containment), ids ignored, order per tile (PLAN Doubts)."""

from __future__ import annotations

import re

TS_TOLERANCE_MS = 300


def normalise(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", text.lower())).strip()


def _actual_ts(env: dict) -> int | None:
    data = env.get("data", {})
    for key in ("ts_start_ms", "ts_ms", "t0_ms"):
        if key in data:
            return int(data[key])
    return None


def _actual_tile(env: dict) -> str | None:
    data = env.get("data", {})
    if "tile_id" in data:
        return data["tile_id"]
    tiles = data.get("tiles") or []
    return tiles[0]["tile_id"] if tiles else None


def _texts_compatible(want: str, env: dict) -> bool:
    actual_text = normalise(str(env.get("data", {}).get("text", "")))
    want_n = normalise(want)
    return bool(actual_text) and (want_n in actual_text or actual_text in want_n)


def _compatible(exp: dict, env: dict) -> bool:
    """Match-time guard: an actual event only fills an expected slot when its
    ts and text (when the expectation pins them) agree with it. Soft-cut
    extras (a prefix piece or a duplicate full-text final from an earlier
    turn) are skipped here instead of matching as the next turn and failing
    the post-match checks below. A genuinely missing or mis-timed event still
    reports as missing, since no later actual is compatible either."""
    if "ts_ms" in exp:
        ts = _actual_ts(env)
        if ts is not None and abs(ts - int(exp["ts_ms"])) > TS_TOLERANCE_MS:
            return False
    if exp.get("text"):
        return _texts_compatible(exp["text"], env)
    return True


def check(expected: list[dict], actual: list[dict]) -> list[str]:
    errors: list[str] = []
    used = [False] * len(actual)
    cursor = 0  # per-run order: matches must appear in expected order
    for exp in expected:
        found = None
        for i in range(cursor, len(actual)):
            env = actual[i]
            if used[i] or env.get("type") != exp["type"]:
                continue
            if exp.get("tile_id") and _actual_tile(env) != exp["tile_id"]:
                continue
            if not _compatible(exp, env):
                continue
            found = i
            break
        if found is None:
            errors.append(f"missing {exp['type']} tile={exp.get('tile_id')}")
            continue
        used[found] = True
        cursor = found + 1
        env = actual[found]
        ts = _actual_ts(env)
        if ts is not None and "ts_ms" in exp and abs(ts - int(exp["ts_ms"])) > TS_TOLERANCE_MS:
            errors.append(f"{exp['type']} ts {ts} vs expected {exp['ts_ms']} beyond ±{TS_TOLERANCE_MS} ms")
        if exp.get("text"):
            actual_text = normalise(str(env.get("data", {}).get("text", "")))
            want = normalise(exp["text"])
            if want not in actual_text and actual_text not in want:
                errors.append(f"{exp['type']} text {actual_text!r} does not contain {want!r}")
    return errors
