import json
from pathlib import Path

from jsonschema import Draft202012Validator

from contracts.validate import validate_envelope

GOLDEN = Path(__file__).parents[1] / "golden"
TYPES = [
    "pair.hello", "pair.ok", "pair.rejected", "meeting.started", "meeting.ended", "system.status",
    "meeting.context", "tiles.snapshot", "speaker.active", "transcript.final", "turn.attributed",
    "speaker.mapped", "points.upsert", "llm.health", "tags.set", "notes.ready",
]


def test_every_type_has_a_valid_golden_sample():
    for type_ in TYPES:
        sample = json.loads((GOLDEN / f"{type_}.json").read_text(encoding="utf-8"))
        assert sample["type"] == type_, type_
        assert validate_envelope(sample) == [], type_


def test_golden_page_json_matches_schema():
    schema = json.loads((GOLDEN.parent / "meeting-page.schema.json").read_text(encoding="utf-8"))
    page = json.loads((GOLDEN / "page.json").read_text(encoding="utf-8"))
    errors = [e.message for e in Draft202012Validator(schema).iter_errors(page)]
    assert errors == []
    assert page["points"][0]["turn_ids"] == [page["transcript_lines"][0]["turn_id"]]
