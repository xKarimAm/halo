# Ensures the repo root and backend/ are importable (contracts, halo packages) under pytest.
import sys
from pathlib import Path

_ROOT = Path(__file__).parent
for _p in (_ROOT, _ROOT / "backend"):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))
