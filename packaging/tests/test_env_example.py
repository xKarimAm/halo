"""Packaging guardrail: every env var the backend reads is documented.

Scans non-test Python under backend/ and rig/ for HALO_*/META_*/BASETEN_*
literals (the repo convention: ALL_CAPS names are environment) and asserts
each one has a `NAME=` line in `.env.example`. Add the line when you add a
variable; this test fails otherwise.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENV_RE = re.compile(r"""["']((?:HALO|META|BASETEN)[A-Z_]*)["']""")


def _code_names() -> set[str]:
    names: set[str] = set()
    for base in (ROOT / "backend", ROOT / "rig"):
        for path in base.rglob("*.py"):
            if "tests" in path.parts:
                continue
            names.update(ENV_RE.findall(path.read_text(encoding="utf-8")))
    return names


def _documented_names() -> set[str]:
    names: set[str] = set()
    for raw in (ROOT / ".env.example").read_text(encoding="utf-8").splitlines():
        line = raw.strip().removeprefix("export ").strip()
        name, sep, _ = line.partition("=")
        if sep and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name.strip()):
            names.add(name.strip())
    return names


def test_every_env_var_is_documented():
    missing = sorted(_code_names() - _documented_names())
    assert missing == [], f"undocumented env vars in .env.example: {missing}"
