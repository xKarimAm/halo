"""Protocol unit tests: handshake builder + turn assembler."""

from halo.transcriber.protocol import (
    DIARIZATION,
    ENDPOINTING,
    TurnAssembler,
    build_handshake,
    normalize_lang,
)


def test_handshake_carries_bearer_mode_bias_keywords():
    hs = build_handshake(DIARIZATION, "key-123", ["Pricing", "RTL"])
    assert hs["authorization"] == {"accessToken": "Bearer key-123"}
    assert hs["mode"] == DIARIZATION
    assert hs["languageBias"] == ["Arabic", "English"]
    # Without these the real endpoint closes with 1008 Bad Request (live probe).
    assert hs["model"] == "muse-voice-transcribe-1.0"
    assert hs["audioEncoding"] == "PCM_16KHZ"
    assert hs["partialMode"] == "CUMULATIVE"
    assert hs["keywords"] == ["Pricing", "RTL"]
    hs2 = build_handshake(ENDPOINTING, "key-123")
    assert hs2["mode"] == ENDPOINTING
    assert hs2["keywords"] == []


def test_normalize_lang():
    assert normalize_lang("arabic") == "ar"
    assert normalize_lang("en") == "en"
    assert normalize_lang("mixed") == "mixed"
    assert normalize_lang("unexpected-label") == "mixed"


def feed(assembler, messages):
    out = []
    for message in messages:
        completed = assembler.handle(message)
        if completed is not None:
            out.append(completed)
    return out


def lifecycle(turn_id, text, speaker, start, end, lang="en"):
    return [
        {"type": "speechStart", "turnId": turn_id},
        {"type": "partial", "turnId": turn_id, "text": text[:10]},
        {"type": "partial", "turnId": turn_id, "text": text},
        {"type": "speaker", "turnId": turn_id, "speaker": speaker},
        {"type": "speechEnd", "turnId": turn_id},
        {"type": "speechComplete", "turnId": turn_id, "startMs": start, "endMs": end, "lang": lang},
    ]


def test_assembler_completes_turn():
    [turn] = feed(TurnAssembler(), lifecycle("t1", "Launch moves", "A", 100, 900))
    assert turn["speaker"] == "A"
    assert turn["text"] == "Launch moves"
    assert (turn["start_offset_ms"], turn["end_offset_ms"]) == (100, 900)
    assert turn["relative"] is True
    assert turn["lang"] == "en"


def test_assembler_keyed_by_turn_id_not_arrival_order():
    assembler = TurnAssembler()
    first = lifecycle("t1", "first turn here", "A", 100, 500)
    second = lifecycle("t2", "second turn here", "B", 600, 900)
    turns = feed(assembler, first[:4] + second[:4] + first[4:] + second[4:])
    by_speaker = {t["speaker"]: t["text"] for t in turns}
    assert by_speaker == {"A": "first turn here", "B": "second turn here"}


def test_assembler_final_partial_completes():
    assembler = TurnAssembler()
    turns = feed(assembler, [
        {"type": "speechStart", "turnId": "t9"},
        {"type": "partial", "turnId": "t9", "text": "done deal", "final": True},
    ])
    assert len(turns) == 1
    assert turns[0]["text"] == "done deal"
