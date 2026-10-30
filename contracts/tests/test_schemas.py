import copy

import pytest

from contracts.binary import MIC, TAB, FrameError, pack_audio, pack_rec, parse_header
from contracts.validate import validate_ack, validate_envelope

BASE = {
    "specversion": "1.0",
    "id": "11111111-1111-4111-8111-111111111111",
    "source": "halo/test",
    "time": "2026-10-31T09:00:00Z",
    "datacontenttype": "application/json",
}
MEETING = "22222222-2222-4222-8222-222222222222"


def env(type_, data, meetingid=MEETING):
    return {**BASE, "type": type_, "meetingid": meetingid, "data": data}


def test_pair_hello_allows_null_meetingid():
    assert validate_envelope(env("pair.hello", {"token": "tok", "ext_version": "0.1.0"}, meetingid=None)) == []


def test_points_upsert_rejects_null_meetingid_and_bad_rank():
    data = {
        "point_id": "33333333-3333-4333-8333-333333333333", "tile_id": "t1", "speaker_name": "Layla",
        "kind": "point", "text": "x", "lang": "en", "quote": "x",
        "turn_ids": ["44444444-4444-4444-8444-444444444444"], "rank": 4,
        "attribution": "locked", "is_action": False, "engine": "spark-open",
    }
    assert validate_envelope(env("points.upsert", data, meetingid=None))
    assert validate_envelope(env("points.upsert", data))


def test_missing_type_and_unknown_type_reject():
    bad = env("points.upsert", {})
    del bad["type"]
    assert validate_envelope(bad)
    assert validate_envelope(env("nope.type", {}))


def test_ack_closed_error_codes():
    assert validate_ack({"ack_of": BASE["id"], "status": "ok"}) == []
    assert validate_ack({"ack_of": BASE["id"], "status": "error",
                         "error": {"code": "unpaired", "message": "pair first"}}) == []
    assert validate_ack({"ack_of": BASE["id"], "status": "error",
                         "error": {"code": "made_up", "message": "x"}})


def test_binary_headers_round_trip_little_endian():
    frame = pack_audio(TAB, 7, 123456, b"\x01\x02")
    head = parse_header(frame)
    assert (head["kind"], head["stream"], head["seq"], head["ts_ms"]) == (1, TAB, 7, 123456)
    assert frame[0] == 1 and frame[1] == 0
    mic = pack_audio(MIC, 1, 5, b"")
    assert parse_header(mic)["stream"] == 1 and mic[1] == 1
    rec = parse_header(pack_rec(3, 99, b"webm"))
    assert (rec["kind"], rec["seq"], rec["ts_ms"]) == (3, 3, 99)


def test_binary_kind2_rejected():
    with pytest.raises(FrameError):
        parse_header(bytes([2, 0, 0, 0, 0]))
    bad = copy.deepcopy(BASE)
    assert bad  # keep copy import honest
