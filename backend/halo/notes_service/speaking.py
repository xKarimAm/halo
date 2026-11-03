"""Your speaking (Karim 2026-11-03): private facts about how the viewer talked.

Only countable facts from the timestamped turns, each with the moment it came
from, plus one thing to try next call. Research behind the choice (night
report 2026-11-03): how the conversation is shared (talk share, monologue,
questions, interruptions) is what listeners react to; text alone cannot judge
tone, nerves or confidence, so there is no score and no emotion word here.
Filler counts are left out because speech-to-text drops most "um"s.
"""

from __future__ import annotations

import re
from typing import Any

MERGE_GAP_MS = 3000  # own turns closer than this, with nobody between, are one stretch
LONG_STRETCH_MS = 150_000  # 2.5 min: the common coaching ceiling for one stretch
OVERLAP_MS = 500  # starting this far inside someone's turn is cutting in
MIN_PACE_MS = 5000  # pace only from turns long enough to measure

QUESTION_START = re.compile(
    r"^(what|why|how|when|where|who|which|can|could|should|would|do|does|did|is|are|will|"
    r"have|has)\b", re.IGNORECASE)
HEDGE = re.compile(r"\b(i think|maybe|probably|sort of|kind of|i guess|hopefully|perhaps)\b", re.IGNORECASE)
COMMIT = re.compile(r"\b(i'll|i will|we'll|we will|i can|we can|by (monday|tuesday|"
                    r"wednesday|thursday|friday|tomorrow|next week|end of))\b", re.IGNORECASE)


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.?!؟])\s+", text) if s.strip()]


def _is_question(sentence: str) -> bool:
    return sentence.endswith(("?", "؟")) or bool(QUESTION_START.match(sentence))


def speaking_insights(turns: list[dict[str, Any]], me: str, t0_ms: int) -> dict[str, Any] | None:
    """turns: {speaker, text, ts_start_ms, ts_end_ms} in time order. None when
    the viewer said too little to say anything honest."""
    mine = [t for t in turns if t["speaker"] == me]
    if len(mine) < 3:
        return None

    def dur(t: dict[str, Any]) -> int:
        return max(0, t["ts_end_ms"] - t["ts_start_ms"])

    total = sum(dur(t) for t in turns) or 1
    speakers = {t["speaker"] for t in turns}
    my_ms = sum(dur(t) for t in mine)

    # Longest stretch: own turns joined while nobody else speaks in between.
    best, run = (0, 0), None
    for t in turns:
        if t["speaker"] != me:
            run = None
            continue
        if run and t["ts_start_ms"] - run[1] <= MERGE_GAP_MS:
            run = (run[0], t["ts_end_ms"])
        else:
            run = (t["ts_start_ms"], t["ts_end_ms"])
        if run[1] - run[0] > best[1] - best[0]:
            best = run

    questions, follow_ups, cut_ins, hedged = 0, 0, [], []
    for i, t in enumerate(turns):
        if t["speaker"] != me:
            continue
        prev = turns[i - 1] if i else None
        asked = [s for s in _sentences(t["text"]) if _is_question(s)]
        questions += len(asked)
        if asked and prev and prev["speaker"] != me:
            follow_ups += 1
        if (prev and prev["speaker"] != me and t["ts_start_ms"] < prev["ts_end_ms"] - OVERLAP_MS
                and len(t["text"].split()) > 3):  # a "yeah, right" is listening, not cutting in
            cut_ins.append({"name": prev["speaker"], "at_ms": t["ts_start_ms"] - t0_ms})
        for s in _sentences(t["text"]):
            if HEDGE.search(s) and COMMIT.search(s) and len(hedged) < 2:
                hedged.append({"quote": s, "at_ms": t["ts_start_ms"] - t0_ms})

    timed = [t for t in mine if dur(t) >= MIN_PACE_MS]
    words = sum(len(t["text"].split()) for t in timed)
    pace = round(words / (sum(dur(t) for t in timed) / 60000)) if timed else None

    share = round(100 * my_ms / total)
    fair = round(100 / len(speakers))
    stretch_ms = best[1] - best[0]
    return {
        "name": me, "talk_share": share, "fair_share": fair, "speakers": len(speakers),
        "longest_ms": stretch_ms, "longest_at_ms": best[0] - t0_ms,
        "questions": questions, "follow_ups": follow_ups,
        "cut_ins": cut_ins, "pace_wpm": pace, "hedged": hedged,
        "try_next": _try_next(share, fair, len(speakers), stretch_ms, questions, cut_ins, hedged),
    }


def _try_next(share: int, fair: int, speakers: int, stretch_ms: int, questions: int,
              cut_ins: list[dict[str, Any]], hedged: list[dict[str, Any]]) -> dict[str, str]:
    """One focus for next call, the biggest gap first (one change at a time
    helps; a list of grades does not). key = which fact it comes from."""
    if speakers > 1 and cut_ins:
        return {"key": "cut_ins"}
    if speakers > 1 and stretch_ms > LONG_STRETCH_MS:
        return {"key": "longest"}
    if speakers > 1 and share > 1.5 * fair and share > 50:
        return {"key": "share"}
    if hedged:
        return {"key": "hedged"}
    if speakers > 1 and questions == 0:
        return {"key": "questions"}
    return {"key": "keep" if speakers > 1 else "solo"}

