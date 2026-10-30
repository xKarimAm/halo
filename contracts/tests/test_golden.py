import copy
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


def test_golden_page_json_carries_issue14_fields():
    # Issue #14 (approved): meeting.degraded, top-level actions[] with
    # point_id, people[].relevant_points / own_points as point_id lists.
    schema = json.loads((GOLDEN.parent / "meeting-page.schema.json").read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema)
    page = json.loads((GOLDEN / "page.json").read_text(encoding="utf-8"))
    assert isinstance(page["meeting"]["degraded"], bool)
    point_ids = {p["point_id"] for p in page["points"]}
    assert page["actions"], "golden page must show at least one action"
    for action in page["actions"]:
        assert action["point_id"] in point_ids
    for person in page["people"]:
        assert set(person["own_points"]) | set(person["relevant_points"]) <= point_ids

    no_degraded = copy.deepcopy(page)
    del no_degraded["meeting"]["degraded"]
    assert list(validator.iter_errors(no_degraded))

    no_point_id = copy.deepcopy(page)
    del no_point_id["actions"][0]["point_id"]
    assert list(validator.iter_errors(no_point_id))

    no_lists = copy.deepcopy(page)
    del no_lists["people"][0]["own_points"]
    assert list(validator.iter_errors(no_lists))
