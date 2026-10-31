"""Transcriber bus tests: meeting lifecycle, turns out, health."""

from __future__ import annotations

import asyncio
import copy
import json
from collections.abc import Callable
from pathlib import Path

from halo.bus.bus import Bus
from halo.transcriber.protocol import DIARIZATION, ENDPOINTING
from halo.transcriber.tests.fake_transport import FakeTransport
from halo.transcriber.transcriber import Transcriber

from contracts.validate import validate_envelope
from rig.fakes.fake_asr import FakeASR
from rig.fakes.scripts import AsrTurn

GOLDEN = Path(__file__).parents[4] / "contracts" / "golden"
ANCHOR = 1760000000000
FRAME = b"\x01\x02" * 1600


def golden(name: str) -> dict:
    return json.loads((GOLDEN / f"{name}.json").read_text(encoding="utf-8"))


def make_factory(
    scripts: dict[str, list[AsrTurn]],
) -> tuple[Callable[[str, str], FakeTransport], dict[str, FakeTransport]]:
    fakes = {stream: FakeASR(list(turns)) for stream, turns in scripts.items()}
    transports: dict[str, FakeTransport] = {}

    def factory(stream: str, mode: str) -> FakeTransport:
        transports[stream] = FakeTransport(fakes[stream], stream)
        return transports[stream]

    return factory, transports


def tab_turn(text: str, start: int, end: int, speaker: str = "A") -> AsrTurn:
    return AsrTurn(stream="tab", speaker=speaker, text=text, lang="en",
                  ts_start_ms=start, ts_end_ms=end)


def scenario(factory) -> dict:
    async def go() -> dict:
        bus = Bus()
        received: list[dict] = []
        bus.subscribe("transcript.final", received.append)
        qtab: asyncio.Queue = asyncio.Queue()
        qmic: asyncio.Queue = asyncio.Queue()
        tr = Transcriber(bus, qtab, qmic, factory, key="fake-key", keywords=["Pricing"])
        await bus.publish(golden("meeting.started"))
        for i in range(12):
            qtab.put_nowait({"seq": i, "ts_ms": ANCHOR + i * 100, "pcm": FRAME})
        for _ in range(100):
            if received:
                break
            await asyncio.sleep(0.05)
        ended = golden("meeting.ended")
        await bus.publish(ended)
        await bus.publish({**copy.deepcopy(ended), "id": "00000006-0000-4000-8000-000000000006"})
        await asyncio.sleep(0.3)
        current = asyncio.current_task()
        for task in asyncio.all_tasks():
            if task is not current:
                task.cancel()
        await asyncio.gather(*[t for t in asyncio.all_tasks() if t is not current],
                             return_exceptions=True)
        return {"received": received, "close_calls": tr.close_calls, "health": tr.health_status()}

    return asyncio.run(go())


def test_turns_published_valid_and_ended_once():
    scripts = {
        "tab": [tab_turn("Launch moves to Nov 12.", 300, 900)],
        "mic": [AsrTurn(stream="mic", speaker="A", text="My note.", lang="en",
                        ts_start_ms=300, ts_end_ms=700)],
    }
    factory, _transports = make_factory(scripts)
    out = scenario(factory)
    assert out["received"], "no transcript.final published"
    for env in out["received"]:
        assert validate_envelope(env) == []
    tab_turns = [e for e in out["received"] if e["data"]["stream"] == "tab"]
    assert tab_turns and tab_turns[0]["data"]["speaker"] == "A"
    assert abs(tab_turns[0]["data"]["ts_start_ms"] - (ANCHOR + 300)) <= 200
    assert out["close_calls"] == 2, "both sessions close exactly once"
    assert out["health"] == "ok"


def test_gateway_tuple_frames_flow():
    """Gateway AudioRouter enqueues (seq, ts_ms, payload) tuples, not dicts:
    the session pump must consume that shape (joined gate regression)."""
    scripts = {"tab": [tab_turn("Launch moves to Nov 12.", 300, 900)], "mic": []}
    factory, _ = make_factory(scripts)

    async def go() -> list[dict]:
        bus = Bus()
        received: list[dict] = []
        bus.subscribe("transcript.final", received.append)
        qtab: asyncio.Queue = asyncio.Queue()
        qmic: asyncio.Queue = asyncio.Queue()
        Transcriber(bus, qtab, qmic, factory, key="fake-key")
        await bus.publish(golden("meeting.started"))
        for i in range(12):
            qtab.put_nowait((i, ANCHOR + i * 100, FRAME))  # Gateway tuple shape
        for _ in range(100):
            if received:
                break
            await asyncio.sleep(0.05)
        current = asyncio.current_task()
        for task in asyncio.all_tasks():
            if task is not current:
                task.cancel()
        await asyncio.gather(*[t for t in asyncio.all_tasks() if t is not current],
                             return_exceptions=True)
        return received

    received = asyncio.run(go())
    assert received and received[0]["data"]["text"] == "Launch moves to Nov 12."


def test_modes_wired_per_stream():
    seen: dict[str, str] = {}

    def factory(stream: str, mode: str) -> FakeTransport:
        seen[stream] = mode
        inner, _ = make_factory({"tab": [], "mic": []})
        return inner(stream, mode)

    async def go() -> None:
        bus = Bus()
        qtab: asyncio.Queue = asyncio.Queue()
        qmic: asyncio.Queue = asyncio.Queue()
        Transcriber(bus, qtab, qmic, factory)
        await bus.publish(golden("meeting.started"))
        await asyncio.sleep(0.2)
        current = asyncio.current_task()
        for task in asyncio.all_tasks():
            if task is not current:
                task.cancel()
        await asyncio.gather(*[t for t in asyncio.all_tasks() if t is not current],
                             return_exceptions=True)

    asyncio.run(go())
    assert seen == {"tab": DIARIZATION, "mic": ENDPOINTING}


def test_replayed_started_keeps_open_sessions():
    """Issue #57: a repeated meeting.started for the active meeting opens no
    second pair of engine sessions."""
    opened: list[str] = []
    factory, _ = make_factory({"tab": [], "mic": []})

    def counting(stream: str, mode: str) -> FakeTransport:
        opened.append(stream)
        return factory(stream, mode)

    async def go() -> None:
        bus = Bus()
        Transcriber(bus, asyncio.Queue(), asyncio.Queue(), counting, key="fake-key")
        await bus.publish(golden("meeting.started"))
        await bus.publish(golden("meeting.started"))
        current = asyncio.current_task()
        for task in asyncio.all_tasks():
            if task is not current:
                task.cancel()
        await asyncio.gather(*[t for t in asyncio.all_tasks() if t is not current],
                             return_exceptions=True)

    asyncio.run(go())
    assert sorted(opened) == ["mic", "tab"]


def test_context_after_start_reaches_voice_as_keywords():
    """The hub sends meeting.started, then meeting.context. Sessions opened on
    meeting.started with the previous meeting's terms (none at first), so
    names and product terms never biased Voice (Sudanese clip: Baseten ->
    "Bestin"). Voice fixes keywords at the handshake: the session reopens."""
    factory, transports = make_factory({"tab": [], "mic": []})

    async def go() -> None:
        bus = Bus()
        qtab: asyncio.Queue = asyncio.Queue()
        Transcriber(bus, qtab, asyncio.Queue(), factory, key="fake-key")
        await bus.publish(golden("meeting.started"))
        await bus.publish(golden("meeting.context"))
        for i in range(3):
            qtab.put_nowait((i, ANCHOR + i * 100, FRAME))
        await asyncio.sleep(0.3)
        current = asyncio.current_task()
        for task in asyncio.all_tasks():
            if task is not current:
                task.cancel()
        await asyncio.gather(*[t for t in asyncio.all_tasks() if t is not current],
                             return_exceptions=True)

    asyncio.run(go())
    context = golden("meeting.context")["data"]
    want = [context["subject"], *context["agenda"], *(r["name"] for r in context["roles"])]
    assert transports["tab"].handshakes[-1]["keywords"] == want


def test_new_meeting_replaces_the_open_one_never_stacks():
    """Live 2026-10-31: 5 Starts = 5 meeting.started with new ids. Each opened
    two more Voice sessions and pump tasks while the old ones kept running,
    all pulling from the same audio queues. A new meeting must close the open
    one first: one task per stream, one pump, old sessions closed."""
    factory, _ = make_factory({"tab": [], "mic": []})

    async def go() -> tuple[dict[str, int], int]:
        bus = Bus()
        tr = Transcriber(bus, asyncio.Queue(), asyncio.Queue(), factory, key="fake-key")
        first = golden("meeting.started")
        await bus.publish(first)
        second = copy.deepcopy(first)
        second["id"] = "00000009-0000-4000-8000-000000000009"
        second["meetingid"] = second["data"]["meeting_id"] = "33333333-3333-4333-8333-333333333333"
        await bus.publish(second)
        await asyncio.sleep(0.3)
        current = asyncio.current_task()
        running = [t.get_name() for t in asyncio.all_tasks() if t is not current and not t.done()]
        counts = {name: running.count(name) for name in
                  ("halo-transcriber-tab", "halo-transcriber-mic", "halo-transcriber-pump")}
        for task in asyncio.all_tasks():
            if task is not current:
                task.cancel()
        await asyncio.gather(*[t for t in asyncio.all_tasks() if t is not current], return_exceptions=True)
        return counts, tr.close_calls

    counts, close_calls = asyncio.run(go())
    assert counts == {"halo-transcriber-tab": 1, "halo-transcriber-mic": 1, "halo-transcriber-pump": 1}
    assert close_calls == 2, "the first meeting's tab and mic sessions closed"
