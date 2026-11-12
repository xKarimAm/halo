# Ensures the repo root and backend/ are importable (contracts, halo packages) under pytest.
import sys
from pathlib import Path

_ROOT = Path(__file__).parent
for _p in (_ROOT, _ROOT / "backend"):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import pytest


@pytest.fixture(autouse=True)
def _no_provider_switch(monkeypatch: pytest.MonkeyPatch) -> None:
    """Importing halo.app loads the developer's .env; HALO_GEMINI there must not
    move the Meta-path tests to Google. Gemini tests pass their own env."""
    monkeypatch.delenv("HALO_GEMINI", raising=False)
