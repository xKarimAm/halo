"""Public validation seam for Halo contracts (L0).

Each ``<type>.schema.json`` validates the envelope ``data`` object.
``envelope.schema.json`` validates the CloudEvents wrapper. This module
combines both and enforces the meetingid rule: null is allowed only for
``pair.*``, ``system.status`` and ``llm.health``.
"""

from __future__ import annotations

import json
from pathlib import Path

from jsonschema import Draft202012Validator

HERE = Path(__file__).parent
NULL_MEETING_OK = ("pair.", "system.status", "llm.health")


def _load(name: str) -> dict:
    return json.loads((HERE / f"{name}.schema.json").read_text(encoding="utf-8"))


def _validator(name: str) -> Draft202012Validator:
    return Draft202012Validator(_load(name))


def validate_envelope(envelope: dict) -> list[str]:
    """Return a list of validation errors; empty means valid."""
    errors = [e.message for e in _validator("envelope").iter_errors(envelope)]
    if errors:
        return errors
    etype = envelope["type"]
    meetingid = envelope.get("meetingid")
    if meetingid is None and not etype.startswith(NULL_MEETING_OK):
        errors.append(f"meetingid must not be null for {etype}")
    try:
        data_errors = [e.message for e in _validator(etype).iter_errors(envelope["data"])]
    except FileNotFoundError:
        return [f"unknown_type: no schema for {etype}"]
    return errors + data_errors


def validate_ack(ack: dict) -> list[str]:
    return [e.message for e in _validator("ack").iter_errors(ack)]
