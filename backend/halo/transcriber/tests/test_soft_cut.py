"""Soft-cut tests: real Voice wire shapes + pause splitting.

The day-0 arabic-asr probe showed Voice closes a turn ONLY on a speaker
change (a 136 s monologue = ONE turn), with partials shaped as
{"type": "transcript", "transcript": <cumulative>, "final": false} carrying
NO turnId, an int turnId, the speaker label arriving at the END of the turn,
and speechComplete carrying the full text under "transcript". The transcriber
must still emit about one transcript.final per spoken line, so it soft-cuts
open turns at PCM pauses (>= 1000 ms of RMS silence) and emits only the
uncut remainder on speechComplete.

Fixture: soft_cut_fixture.json = speechStart + the first 45 transcript
partials verbatim from results-karim.json (DIARIZATION), then turn-end
events with audioProcessedMs shifted to the slice end (speechComplete's
transcript = the last partial's text). ReplayTransport releases wire events
by the audio clock while feed_frame advances it, so silence frames between
partials drive the soft-cut exactly like live audio.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from halo.transcriber.protocol import (
    DIARIZATION,
    SOFT_CUT_TAIL_WORDS,
    TurnAssembler,
)
from halo.transcriber.session import EngineTransport, TranscriptionSession

FIXTURE = json.loads(
    (Path(__file__).parent / "soft_cut_fixture.json").read_text(encoding="utf-8")
)["events"]

ANCHOR = 1760000000000
FRAME_MS = 100
SILENCE = b"\x00\x00" * 1600  # 100 ms of PCM16 silence
SPEECH = b"\x00\x10" * 1600  # 100 ms of loud PCM16 (RMS well above silence)


def norm(text: str) -> str:
    return " ".join(str(text).split())


class ReplayTransport(EngineTransport):
    """Releases recorded wire events when the audio clock reaches them."""

    def __init__(self, events: list[dict[str, Any]], base_ms: int) -> None:
        self._pending = [
            (int(e.get("audioProcessedMs", 0)) - base_ms, dict(e)) for e in events
        ]
        self.position_ms = 0

    async def open(self, handshake: dict[str, Any]) -> None:
        pass

    async def send_audio(self, pcm: bytes, ts_ms: int = 0) -> None:
        self.position_ms += len(pcm) // 32

    async def recv_event(self) -> dict[str, Any] | None:
        due = [e for at, e in self._pending if at <= self.position_ms]
        if not due:
            return None
        first = due[0]
        self._pending = [(at, e) for at, e in self._pending if e is not first]
        return {k: v for k, v in first.items() if k != "t"}

    async def close(self) -> None:
        pass


def drive(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Replay recorded events through a session; silence inside real pauses."""
    base = int(events[0].get("audioProcessedMs", 0))
    shifted = []
    for e in events:
        e = dict(e)
        e.pop("t", None)
        if "audioProcessedMs" in e:
            e["audioProcessedMs"] = int(e["audioProcessedMs"]) - base
        shifted.append(e)
    marks = sorted(
        e["audioProcessedMs"] for e in shifted if e.get("type") == "transcript"
        and e.get("transcript")
    )
    pauses = [
        (a, b) for a, b in zip([0] + marks, marks) if b - a >= 1000
    ]
    transport = ReplayTransport(shifted, 0)
    session = TranscriptionSession("tab", DIARIZATION, transport)

    async def go() -> list[dict[str, Any]]:
        await session.open("key")
        out: list[dict[str, Any]] = []
        last_release = max(at for at, _ in transport._pending)
        clock = 0
        seq = 0
        while transport._pending or clock < last_release + 800:
            silent = any(a <= clock and clock + FRAME_MS <= b for a, b in pauses)
            pcm = SILENCE if silent else SPEECH
            out.extend(await session.feed_frame(seq, ANCHOR + clock, pcm))
            seq += 1
            clock += FRAME_MS
        return out

    return asyncio.run(go())


def feed(assembler: TurnAssembler, messages: list[dict]) -> list[dict]:
    out = []
    for message in messages:
        completed = assembler.handle(message)
        if completed is not None:
            out.append(completed)
    return out


def test_recorded_shapes_split_the_monologue_without_dup_or_loss():
    turns = drive(FIXTURE)
    full = next(e for e in FIXTURE if e.get("type") == "speechComplete")["transcript"]
    # Pauses split the one wire turn into about one final per spoken line.
    assert 4 <= len(turns) <= 12, f"expected a handful of finals, got {len(turns)}"
    assert all(t["text"].strip() for t in turns), "no empty finals"
    assert " ".join(t["text"] for t in turns).split() == norm(full).split(), (
        "concatenation must equal the speechComplete text (no dup, no loss)"
    )
    starts = [t["ts_start_ms"] for t in turns]
    assert starts == sorted(starts), "timestamps monotonic"
    assert all(t["ts_end_ms"] > t["ts_start_ms"] for t in turns)
    assert abs(turns[0]["ts_start_ms"] - ANCHOR) <= 200
    # The diarization label arrives at the END of the turn: early pieces
    # carry "?", and only the remainder (cut after the label) knows "A".
    assert {t["speaker"] for t in turns} <= {"?", "A"}
    assert turns[-1]["speaker"] == "A"


def test_recorded_lifecycle_through_assembler():
    partials = [e for e in FIXTURE if e.get("type") == "transcript"
                and e.get("transcript")][:5]
    last = partials[-1]["transcript"]
    [turn] = feed(TurnAssembler(), [
        {"type": "speechStart", "turnId": 0, "audioProcessedMs": 1180},
        *[{"type": "transcript", "transcript": e["transcript"], "final": False,
            "audioProcessedMs": e["audioProcessedMs"]} for e in partials],
        {"type": "speaker", "label": "A", "audioProcessedMs": 9000},
        {"type": "speechEnd", "turnId": 0, "audioProcessedMs": 9200},
        {"type": "speechComplete", "turnId": 0, "transcript": last,
         "audioProcessedMs": 9200},
        {"type": "transcript", "transcript": "", "final": True,
         "audioProcessedMs": 9500},
    ])
    assert turn["speaker"] == "A"
    assert turn["text"] == last
    assert (turn["start_offset_ms"], turn["end_offset_ms"]) == (1180, 9200)


def test_partial_without_open_turn_is_ignored():
    assert feed(TurnAssembler(), [
        {"type": "transcript", "transcript": "orphan words", "final": False,
         "audioProcessedMs": 500},
    ]) == []


def test_unknown_speaker_is_question_mark():
    [turn] = feed(TurnAssembler(), [
        {"type": "speechStart", "turnId": 7, "audioProcessedMs": 0},
        {"type": "speechComplete", "turnId": 7, "transcript": "no label",
         "audioProcessedMs": 400},
    ])
    assert turn["speaker"] == "?"


def fixture_partial(n: int) -> dict:
    partials = [e for e in FIXTURE
                if e.get("type") == "transcript" and e.get("transcript")]
    return partials[n]


def open_with_partial(assembler: TurnAssembler, text: str, ms: int) -> None:
    assert feed(assembler, [
        {"type": "speechStart", "turnId": 0, "audioProcessedMs": 0},
        {"type": "transcript", "transcript": text, "final": False,
         "audioProcessedMs": ms},
    ]) == []


def test_pause_after_stable_partial_emits_full_sentence():
    """The partial already covers the speech before the pause: the frontier
    is stable, so the cut carries every new word and sentences stay whole."""
    p = fixture_partial(11)
    words = p["transcript"].split()
    assert len(words) > SOFT_CUT_TAIL_WORDS + 1
    assembler = TurnAssembler()
    open_with_partial(assembler, p["transcript"], p["audioProcessedMs"])
    piece = assembler.maybe_cut(pause_start_ms=p["audioProcessedMs"] - 200)
    assert piece is not None and piece["text"].split() == words
    assert assembler.maybe_cut(pause_start_ms=p["audioProcessedMs"] - 200) is None


def test_stale_partial_at_pause_holds_tail():
    """The partial predates the pause: the frontier may still be rewritten,
    so the last words stay uncut for the remainder to fix."""
    p = fixture_partial(11)
    words = p["transcript"].split()
    assembler = TurnAssembler()
    open_with_partial(assembler, p["transcript"], p["audioProcessedMs"])
    piece = assembler.maybe_cut(pause_start_ms=p["audioProcessedMs"] + 5000)
    assert piece is not None
    assert piece["text"].split() == words[: -SOFT_CUT_TAIL_WORDS]


def test_session_stale_partial_holds_tail():
    """Session wiring: the pause start passed to maybe_cut is the audio
    position where the silence run began."""
    text = "one two three four five six seven"
    events = [
        {"type": "speechStart", "turnId": 0, "audioProcessedMs": 0},
        {"type": "transcript", "transcript": text, "final": False,
         "audioProcessedMs": 500},
        {"type": "speaker", "label": "A", "audioProcessedMs": 3100},
        {"type": "speechEnd", "turnId": 0, "audioProcessedMs": 3200},
        {"type": "speechComplete", "turnId": 0, "transcript": text,
         "audioProcessedMs": 3200},
        {"type": "transcript", "transcript": "", "final": True,
         "audioProcessedMs": 3400},
    ]
    transport = ReplayTransport(events, 0)
    session = TranscriptionSession("tab", DIARIZATION, transport)

    async def go() -> list[dict]:
        await session.open("key")
        out: list[dict] = []
        for seq in range(42):  # 4.2 s of audio; silence from 2.0 s
            pcm = SILENCE if seq >= 20 else SPEECH
            out.extend(await session.feed_frame(seq, ANCHOR + seq * FRAME_MS, pcm))
        return out

    turns = asyncio.run(go())
    # The only partial (audio ms 500) predates the pause at 2000: the tail
    # is held, and the completion carries just the remainder.
    assert [t["text"] for t in turns] == ["one two three four", "five six seven"]
    assert turns[0]["speaker"] == "?" and turns[1]["speaker"] == "A"


def test_soft_cut_holds_back_the_tail_and_never_repeats():
    assembler = TurnAssembler()
    assert feed(assembler, [
        {"type": "speechStart", "turnId": 0, "audioProcessedMs": 0},
        {"type": "transcript", "transcript": "one two three four five six",
         "final": False, "audioProcessedMs": 900},
    ]) == []
    first = assembler.maybe_cut()
    assert first is not None and first["text"] == "one two three"
    assert assembler.maybe_cut() is None, "no growth, no second cut"
    assert feed(assembler, [
        {"type": "transcript", "transcript": "one two three four five six seven eight",
         "final": False, "audioProcessedMs": 1400},
    ]) == []
    second = assembler.maybe_cut()
    assert second is not None and second["text"] == "four five"
    [turn] = feed(assembler, [
        {"type": "speaker", "label": "A", "audioProcessedMs": 1500},
        {"type": "speechComplete", "turnId": 0,
         "transcript": "one two three four five six seven eight",
         "audioProcessedMs": 1600},
    ])
    assert turn["text"] == "six seven eight"
    assert turn["speaker"] == "A"
