"""Gemini Live transcription frames -> the Voice event shapes TurnAssembler reads.
Frame shapes are the ones gemini-3.5-transcribe-live sent on 2026-11-13 (probe)."""

from halo.transcriber.protocol import TurnAssembler
from halo.transcriber.transport import GeminiEvents, gemini_setup


def _act(kind: str, offset: str) -> dict:
    return {"serverContent": {}, "voiceActivity": {"type": kind, "audioOffset": offset}}


def _interim(text: str) -> dict:
    return {"serverContent": {"interimInputTranscription": {"text": text}}}


def _final(text: str) -> dict:
    return {"serverContent": {"inputTranscription": {"text": text}}}


def test_live_order_assembles_one_turn_with_offsets():
    ev, asm = GeminiEvents(), TurnAssembler()
    frames = [{"setupComplete": {}}, _act("ACTIVITY_START", "0.200s"), _interim("I think"),
              _interim("I think في lag"), _final("I think في lag في ال API call."),
              {"serverContent": {"generationComplete": True}}, _act("ACTIVITY_END", "12.440s")]
    turns = [t for f in frames for e in ev.translate(f) if (t := asm.handle(e))]
    assert len(turns) == 1
    assert turns[0]["text"] == "I think في lag في ال API call."
    assert (turns[0]["start_offset_ms"], turns[0]["end_offset_ms"]) == (200, 12440)


def test_end_before_final_still_completes_and_turn_ids_advance():
    ev, asm = GeminiEvents(), TurnAssembler()
    frames = [_act("ACTIVITY_START", "1s"), _act("ACTIVITY_END", "2.5s"), _final("first"),
              _act("ACTIVITY_START", "3s"), _final("second"), _act("ACTIVITY_END", "4s")]
    turns = [t for f in frames for e in ev.translate(f) if (t := asm.handle(e))]
    assert [t["text"] for t in turns] == ["first", "second"]
    assert [t["end_offset_ms"] for t in turns] == [2500, 4000]


def test_interim_is_cumulative_partial_for_the_open_turn():
    ev, asm = GeminiEvents(), TurnAssembler()
    for f in (_act("ACTIVITY_START", "0s"), _interim("hello there")):
        for e in ev.translate(f):
            asm.handle(e)
    assert asm.open_text() == "hello there"


def test_empty_final_emits_nothing():
    ev = GeminiEvents()
    ev.translate(_act("ACTIVITY_START", "0s"))
    assert ev.translate(_final("")) == []
    assert ev.translate(_act("ACTIVITY_END", "1s")) == []


def test_setup_carries_model_vocabulary_and_auto_language():
    s = gemini_setup(["Halo", "Spark"])["setup"]
    assert s["model"] == "models/gemini-3.5-transcribe-live"
    assert s["inputAudioTranscription"] == {"languageCodes": [], "customVocabulary": ["Halo", "Spark"]}
    assert s["realtimeInputConfig"]["automaticActivityDetection"]["silenceDurationMs"] == 600


def test_interims_carry_no_audio_position_so_the_session_never_soft_cuts():
    """Gemini's final re-transcribes the turn; cutting interims duplicated text (live 2026-11-13)."""
    ev, asm = GeminiEvents(), TurnAssembler()
    for f in (_act("ACTIVITY_START", "0s"), _interim("one two three four five")):
        for e in ev.translate(f):
            asm.handle(e)
    assert asm.maybe_cut(pause_start_ms=0, min_words=3) is None
