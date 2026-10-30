import json
from pathlib import Path

from contracts import codegen
from contracts.gen.pydantic import models

GOLDEN = Path(__file__).parents[1] / "golden"


def test_codegen_check_passes_with_no_drift():
    assert codegen.main(["--check"]) == 0


def test_generated_pydantic_models_validate_golden_data():
    name_by_type = {
        "pair.hello": models.PairHello,
        "pair.ok": models.PairOk,
        "pair.rejected": models.PairRejected,
        "meeting.started": models.MeetingStarted,
        "meeting.ended": models.MeetingEnded,
        "system.status": models.SystemStatus,
        "meeting.context": models.MeetingContext,
        "tiles.snapshot": models.TilesSnapshot,
        "speaker.active": models.SpeakerActive,
        "transcript.final": models.TranscriptFinal,
        "turn.attributed": models.TurnAttributed,
        "speaker.mapped": models.SpeakerMapped,
        "points.upsert": models.PointsUpsert,
        "llm.health": models.LlmHealth,
        "tags.set": models.TagsSet,
        "notes.ready": models.NotesReady,
    }
    for type_, model in name_by_type.items():
        sample = json.loads((GOLDEN / f"{type_}.json").read_text(encoding="utf-8"))
        model.model_validate(sample["data"])
        models.Envelope.model_validate(sample)
