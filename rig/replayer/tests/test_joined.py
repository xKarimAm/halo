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

import shutil

import pytest

from rig.replayer.joined import run_all

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None or shutil.which("npm") is None,
    reason="joined gate needs Node (extension build + Playwright spec)",
)


def test_joined_gate2_end_to_end() -> None:
    result = run_all()
    assert result["checker_errors"] == []
    assert result["p90_pause_to_point_s"] < 4.0
    assert result["bubble"].get("ok") is True
    assert result["ok"] is True
