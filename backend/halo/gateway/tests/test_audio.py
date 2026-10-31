"""Binary routing tests (PLAN case 5): stream queues, rec queue, kind=2
rejection, gap padding with the 30 s bound. Synchronous: no loop needed."""

from __future__ import annotations

import asyncio

from halo.gateway.audio import MAX_PAD_FRAMES, AudioRouter

from contracts.binary import MIC, TAB, pack_audio, pack_rec

PCM = bytes(range(256)) * 12 + bytes(128)  # 3200 bytes: one 100 ms frame


def drain(queue: asyncio.Queue) -> list:
    out = []
    while True:
        try:
            out.append(queue.get_nowait())
        except asyncio.QueueEmpty:
            return out


def test_audio_routes_streams_and_rec_in_order():
    router = AudioRouter()
    assert router.handle(pack_audio(TAB, 0, 1000, PCM)) == "audio"
    assert router.handle(pack_audio(MIC, 0, 1000, PCM)) == "audio"
    assert router.handle(pack_rec(0, 1000, b"webm")) == "rec"
    tab, mic, rec = (drain(router.queues[name]) for name in ("tab", "mic", "rec"))
    assert tab == [(0, 1000, PCM)] and mic == [(0, 1000, PCM)]
    assert rec == [(0, 1000, b"webm")]


def test_seq_gap_pads_silence_and_logs():
    router = AudioRouter()
    router.handle(pack_audio(TAB, 0, 1000, PCM))
    assert router.handle(pack_audio(TAB, 2, 1200, PCM)) == "audio"
    got = drain(router.queues["tab"])
    assert [seq for seq, _, _ in got] == [0, 1, 2]
    assert got[1][2] == bytes(3200) and got[1][2] != PCM
    assert router.gaps == 1 and router.padded == 1


def test_gap_over_30s_bound_pads_300_and_resyncs():
    router = AudioRouter(audio_mic=asyncio.Queue(maxsize=1000))
    router.handle(pack_audio(MIC, 0, 0, PCM))
    assert router.handle(pack_audio(MIC, 10 + MAX_PAD_FRAMES, 99999, PCM)) == "audio"
    got = drain(router.queues["mic"])
    assert len(got) == 1 + MAX_PAD_FRAMES + 1
    assert [seq for seq, _, _ in got][-1] == 10 + MAX_PAD_FRAMES
    assert router.padded == MAX_PAD_FRAMES
    assert router.handle(pack_audio(MIC, 11 + MAX_PAD_FRAMES, 100999, PCM)) == "audio"


def test_kind2_rejected_and_late_frame_dropped():
    router = AudioRouter()
    assert router.handle(bytes([2, 0, 0, 0, 0]) + b"cut-frames") == "rejected"
    assert router.handle(b"") == "rejected"
    assert router.handle(pack_audio(TAB, 5, 5000, PCM)) == "audio"
    assert router.handle(pack_audio(TAB, 3, 3000, PCM)) == "dropped"
    assert router.dropped == 1
    got = drain(router.queues["tab"])
    assert got == [(5, 5000, PCM)]  # the first frame sets the seq, no padding


def test_full_queue_drops_newest():
    router = AudioRouter(audio_tab=asyncio.Queue(maxsize=1))
    assert router.handle(pack_audio(TAB, 0, 0, PCM)) == "audio"
    assert router.handle(pack_audio(TAB, 1, 100, PCM)) == "dropped"
    assert router.dropped == 1


def test_restarted_hub_seq_resyncs_instead_of_dropping():
    """Live 2026-10-31: a reloaded hub restarts at seq 0; its frames were all dropped."""
    router = AudioRouter()
    for seq in range(200):
        router.handle(pack_audio(TAB, seq, 1000 + seq * 100, PCM))
    drain(router.queues["tab"])
    assert router.handle(pack_audio(TAB, 0, 99_000, PCM)) == "audio"
    assert router.handle(pack_audio(TAB, 1, 99_100, PCM)) == "audio"
    assert router.handle(pack_audio(TAB, 0, 99_000, PCM)) == "dropped"  # a real late frame


def test_newest_socket_owns_a_stream_and_older_ones_are_ignored():
    """Live 2026-10-31: 5 Starts left 5 sockets each sending mic at its own seq.
    The router padded silence for every cross-socket gap and Voice closed
    with 1008 "Audio backlog too large". Only the newest producer may feed a
    stream; its first frame resyncs the seq without padding."""
    router = AudioRouter()
    for seq in range(3):
        assert router.handle(pack_audio(MIC, seq, 1000 + seq * 100, PCM), producer=1) == "audio"
    assert router.handle(pack_audio(TAB, 0, 1000, PCM), producer=1) == "audio"
    assert router.handle(pack_audio(MIC, 40, 5000, PCM), producer=2) == "audio"  # takes over
    assert router.handle(pack_audio(MIC, 3, 1300, PCM), producer=1) == "dropped"  # old socket
    assert router.handle(pack_audio(MIC, 41, 5100, PCM), producer=2) == "audio"
    assert router.handle(pack_audio(TAB, 1, 1100, PCM), producer=1) == "audio"  # still owns tab
    assert router.gaps == 0 and router.padded == 0
    assert [f[0] for f in drain(router.queues["mic"])] == [0, 1, 2, 40, 41]


def test_first_socket_after_a_backend_restart_resyncs_without_padding():
    """A restarted backend's first socket arrives mid-stream (hub seq 6000):
    padding from 0 sent 300 silent frames, then the Transcriber saw a 570 s gap."""
    router = AudioRouter()
    assert router.handle(pack_audio(TAB, 6000, 900_000, PCM), producer=1) == "audio"
    assert router.handle(pack_audio(TAB, 6001, 900_100, PCM), producer=1) == "audio"
    assert router.gaps == 0 and router.padded == 0
    assert [f[0] for f in drain(router.queues["tab"])] == [6000, 6001]
