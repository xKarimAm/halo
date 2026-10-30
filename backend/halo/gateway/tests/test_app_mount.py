"""Composition-root mount test: `app.py` only mounts the gateway router.

Builds a fresh app per test with `HALO_DATA_DIR` pointed at tmp_path, so the
pairing store never touches the repo and the test is independent of import
order (the module-level app singleton keeps whatever cwd first imported it).
(The llm wiring from PR #26 is not in this worktree; Karim merges both
halves of `app.py`.)
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from halo.app import create_app


def test_app_mounts_gateway_router(tmp_path, monkeypatch):
    monkeypatch.setenv("HALO_DATA_DIR", str(tmp_path))
    app = create_app()
    client = TestClient(app, headers={"host": "127.0.0.1:8765"})
    assert "Halo pairing" in client.get("/pair").text
    health = client.get("/healthz").json()
    assert health["status"] == "ok" and "gateway" in health["bus_health"]

    code = app.state.gateway.pairing.current_code
    assert client.post("/pair", json={"code": code}).status_code == 200
