"""Composition-root mount test: `app.py` only mounts the gateway router.

Runs with the cwd inside tmp_path so the pairing store never touches the
repo. (The llm wiring from PR #26 is not in this worktree; Karim merges both
halves of `app.py`.)
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_app_mounts_gateway_router(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    import halo.app as app_module

    client = TestClient(app_module.app, headers={"host": "127.0.0.1:8765"})
    assert "Halo pairing" in client.get("/pair").text
    health = client.get("/healthz").json()
    assert health["status"] == "ok" and "gateway" in health["bus_health"]

    code = app_module.app.state.gateway.pairing.current_code
    assert client.post("/pair", json={"code": code}).status_code == 200
