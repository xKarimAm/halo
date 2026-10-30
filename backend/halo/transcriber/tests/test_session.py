"""Session tests against FakeASR core (meeting-clock asserts)."""

from __future__ import annotations

import asyncio
import logging

from halo.transcriber.protocol import DIARIZATION, ENDPOINTING
from halo.transcriber.session import FRAME_MS, TranscriptionSession
from halo.transcriber.tests.fake_transport import FakeTransport

from rig.fakes.fake_asr import FakeASR
from rig.fakes.scripts import AsrTurn

ANCHOR = 1760000000000
FRAME = b"\x01\x02" * 1600  # 100 ms of PCM16


def script(*turns: AsrTurn) -> FakeASR:
    return FakeASR(list(turns))


def turn(stream: str, speaker: str, text: str, start: int, end: int, lang: str = "en") -> AsrTurn:
    return AsrTurn(stream=stream, speaker=speaker, text=text, lang=lang,
                  ts_start_ms=start, ts_end_ms=end)


def make_session(fake: FakeASR, stream: str, mode: str) -> tuple[TranscriptionSession, FakeTransport]:
    transport = FakeTransport(fake, stream)
    return TranscriptionSession(stream, mode, transport), transport


def feed(session: TranscriptionSession, n: int, start_seq: int = 0, anchor: int = ANCHOR) -> list[dict]:
    async def go() -> list[dict]:
        out: list[dict] = []
        for i in range(n):
            out.extend(await session.feed_frame(start_seq + i, anchor + i * FRAME_MS, FRAME))
        return out

    return asyncio.run(go())


def test_turn_ts_within_200ms_monotonic():
    fake = script(
        turn("tab", "A", "Launch moves to Nov 12.", 1000, 1900),
        turn("tab", "A", "Pricing stays at ten.", 2000, 2800),
    )
    session, _ = make_session(fake, "tab", DIARIZATION)
    asyncio.run(session.open("key"))
    turns = feed(session, 30)
    assert len(turns) == 2
    assert abs(turns[0]["ts_start_ms"] - (ANCHOR + 1000)) <= 200
    assert abs(turns[1]["ts_start_ms"] - (ANCHOR + 2000)) <= 200
    assert all(t["ts_end_ms"] > t["ts_start_ms"] for t in turns)
    stamps = [t["ts_start_ms"] for t in turns]
    assert stamps == sorted(stamps)


def test_tab_diarized_mic_is_you():
    fake = script(
        turn("tab", "A", "Tab words.", 100, 500),
        turn("tab", "B", "Other words.", 600, 900),
        turn("mic", "A", "My words.", 100, 500),
    )
    tab, _ = make_session(fake, "tab", DIARIZATION)
    mic, _ = make_session(fake, "mic", ENDPOINTING)
    asyncio.run(tab.open("key"))
    asyncio.run(mic.open("key"))
    tab_turns = feed(tab, 10)
    mic_turns = feed(mic, 10)
    assert [t["speaker"] for t in tab_turns] == ["A", "B"]
    assert [t["speaker"] for t in mic_turns] == ["you"]
    assert all(t["stream"] == "mic" for t in mic_turns)


def test_code_switch_mixed_kept_whole():
    fake = script(turn("tab", "A", "Lanuch bukra, the pricing stays.", 100, 900, lang="mixed"))
    session, _ = make_session(fake, "tab", DIARIZATION)
    asyncio.run(session.open("key"))
    [got] = feed(session, 10)
    assert got["lang"] == "mixed"
    assert got["text"] == "Lanuch bukra, the pricing stays."


def test_seq_gap_pads_and_stays_on_clock(caplog):
    fake = script(turn("tab", "A", "After the gap.", 1500, 1900))
    session, _ = make_session(fake, "tab", DIARIZATION)
    asyncio.run(session.open("key"))
    with caplog.at_level(logging.WARNING, logger="halo.transcriber"):
        first = asyncio.run(session.feed_frame(0, ANCHOR, FRAME))
        assert first == []
        # seq jumps 1..4 missing: 400 ms of silence padded
        second = asyncio.run(session.feed_frame(5, ANCHOR + 900, FRAME))
        assert second == []
    assert session.pad_ms == 400
    assert any("seq gap" in r.message for r in caplog.records)
    rest = feed(session, 15, start_seq=6, anchor=ANCHOR + 1000)
    assert len(rest) == 1
    assert abs(rest[0]["ts_start_ms"] - (ANCHOR + 1500)) <= 200


def test_forced_drop_reconnecting_then_down():
    fake = script(turn("tab", "A", "Never heard.", 100, 500))
    session, transport = make_session(fake, "tab", DIARIZATION)
    asyncio.run(session.open("key"))
    feed(session, 1)
    fake.drop_session()
    asyncio.run(session.feed_frame(1, ANCHOR + 100, FRAME))
    assert session.health == "reconnecting"
    asyncio.run(session.feed_frame(2, ANCHOR + 200, FRAME))
    assert session.health == "down"
    assert session.closed is True
    # only the pre-drop frame reached the engine; that audio is lost (accepted)
    assert transport.sent_frames == 1


def test_rotation_reopens_at_position():
    fake = script(turn("tab", "A", "Late turn.", 100, 500))
    session, transport = make_session(fake, "tab", DIARIZATION, )
    session.rotation_after_s = 0
    asyncio.run(session.open("key"))
    feed(session, 2)
    assert asyncio.run(session.maybe_rotate()) is True
    assert session.rotations == 1
    assert transport.handshakes and transport.handshakes[0]["mode"] == DIARIZATION
    assert session.position_ms == 200
