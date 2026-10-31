"""Verification gate 2 as a pytest test (the Playwright half lives in
rig/fake_meet/tests/joined.spec.js, driven by the runner): real backend
with HALO_FAKES=1 + built extension on the Fake Meet page + Replayer
Mode A. Asserts the golden checker is clean, p90 pause->point < 4 s,
and the bubble landed on the speaker's tile.

    uv run pytest rig/replayer/tests/test_joined.py -q
    uv run python -m rig.replayer.joined   # same run, for humans

Skips only when Node is unavailable (the extension build and the
Playwright spec need it); the runner fetches Chromium into
.pw-browsers/ on first use.
"""

import json
import shutil

import pytest

from rig.fakes.fake_llm import FakeLLM
from rig.fakes.scripts import LlmReply
from rig.replayer.joined import CLASSIFIER_REPLIES, POINTS, TURNS, run_all

needs_node = pytest.mark.skipif(
    shutil.which("node") is None or shutil.which("npm") is None,
    reason="joined gate needs Node (extension build + Playwright spec)",
)


def test_llm_script_scripts_both_llm_consumers() -> None:
    """FakeLLM replies are single-use with an in-order fallback, and the
    backend now has two consumers (Insight + Classifier). The fixture
    must script the Classifier's replies (matched on its instruction
    line, first in the script) or its fallback burns Insight's replies
    and Insight starves — the day-1 integration failure."""
    fake = FakeLLM([LlmReply(**r) for r in CLASSIFIER_REPLIES + POINTS])
    classifier_prompt = (
        "You assign tags to a meeting point. Reply with ONE JSON object.\n"
        "Decision text: Launch moves to Nov 12"
    )

    def content(resp: dict) -> dict:
        return json.loads(resp["choices"][0]["message"]["content"])

    for i, turn in enumerate(TURNS):  # worst-case interleaving
        assert content(fake.complete(classifier_prompt)) == {
            "kind": "point", "urgency": "medium"}
        got = content(fake.complete(f"You turn meeting turns into live points.\n{turn['text']}"))
        assert got["text"] == POINTS[i]["response"]["text"]


@needs_node
def test_joined_gate2_end_to_end() -> None:
    result = run_all()
    assert result["checker_errors"] == []
    assert result["p90_pause_to_point_s"] < 4.0
    assert result["bubble"].get("ok") is True
    assert result["ok"] is True
