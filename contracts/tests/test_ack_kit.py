import json
from pathlib import Path

from contracts.validate import validate_envelope

KIT = Path(__file__).parents[1] / "ack-kit"


def _load(name: str) -> dict:
    return json.loads((KIT / name).read_text(encoding="utf-8"))


def test_ack_kit_fixtures_and_expectations():
    drop = _load("drop-ack.json")
    assert validate_envelope(drop["envelope"]) == []
    assert drop["drop_first_ack"] is True and drop["resend_after_ms"] == 2000
    assert drop["expected"] == {"sends": 2, "same_id": True, "acks": ["ok"], "bus_publishes": 1, "stored_rows": 1}

    dup = _load("duplicate.json")
    assert dup["envelope"]["id"] == drop["envelope"]["id"]
    assert dup["expected"]["acks"] == ["ok", "ok"]
    assert dup["expected"]["bus_publishes"] == 1 and dup["expected"]["stored_rows"] == 1

    unpaired = _load("unpaired.json")
    assert validate_envelope(unpaired["envelope"]) == []
    assert unpaired["expected"]["ack_error_code"] == "unpaired"

    bad = _load("invalid-schema.json")
    assert validate_envelope(bad["envelope"]) != []
    assert bad["expected"]["ack_error_code"] == "invalid_schema"

    unknown = _load("unknown-type.json")
    assert validate_envelope(unknown["envelope"]) != []
    assert unknown["expected"]["ack_error_code"] == "unknown_type"


def test_ack_kit_readme_names_the_runners():
    readme = (KIT / "README.md").read_text(encoding="utf-8")
    for runner in ("gateway", "hub_capture", "event_store"):
        assert runner in readme
