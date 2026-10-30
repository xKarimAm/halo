"""Binary data-plane framing (little-endian, no envelope, no ACK, no id).

audio  kind=1: [kind u8][stream u8: 0=tab, 1=mic][seq u32][ts_ms u64] + PCM16 mono 16 kHz
rec    kind=3: [kind u8][seq u32][ts_ms u64] + webm bytes
kind=2 is reserved (it was frames, which are cut) and must be rejected.
"""

from __future__ import annotations

import struct

AUDIO, RESERVED, REC = 1, 2, 3
TAB, MIC = 0, 1
_AUDIO_HDR = struct.Struct("<BBIQ")  # kind, stream, seq, ts_ms = 15 bytes, no padding ("<")
_REC_HDR = struct.Struct("<BIQ")  # kind, seq, ts_ms = 13 bytes


class FrameError(ValueError):
    pass


def pack_audio(stream: int, seq: int, ts_ms: int, pcm: bytes) -> bytes:
    if stream not in (TAB, MIC):
        raise FrameError(f"bad stream {stream}")
    return _AUDIO_HDR.pack(AUDIO, stream, seq, ts_ms) + pcm


def pack_rec(seq: int, ts_ms: int, webm: bytes) -> bytes:
    return _REC_HDR.pack(REC, seq, ts_ms) + webm


def parse_header(buf: bytes) -> dict:
    if not buf:
        raise FrameError("empty frame")
    kind = buf[0]
    if kind == RESERVED:
        raise FrameError("kind=2 is reserved, reject")
    if kind == AUDIO:
        if len(buf) < _AUDIO_HDR.size:
            raise FrameError("short audio header")
        _, stream, seq, ts_ms = _AUDIO_HDR.unpack_from(buf)
        return {"kind": kind, "stream": stream, "seq": seq, "ts_ms": ts_ms, "header_size": _AUDIO_HDR.size}
    if kind == REC:
        if len(buf) < _REC_HDR.size:
            raise FrameError("short rec header")
        _, seq, ts_ms = _REC_HDR.unpack_from(buf)
        return {"kind": kind, "seq": seq, "ts_ms": ts_ms, "header_size": _REC_HDR.size}
    raise FrameError(f"unknown kind {kind}")
