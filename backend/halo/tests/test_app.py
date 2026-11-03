from fastapi.testclient import TestClient
from halo.app import create_app


def test_pair_page_serves_and_foreign_host_is_rejected():
    client = TestClient(create_app(), base_url="http://127.0.0.1:8765")
    assert client.get("/pair").status_code == 200
    assert client.get("/healthz").json()["status"] == "ok"
    foreign = TestClient(create_app(), base_url="http://evil.example.com")
    assert foreign.get("/pair").status_code == 400


def test_status_says_whether_the_meta_key_is_set(monkeypatch):
    client = TestClient(create_app(), base_url="http://127.0.0.1:8765")
    monkeypatch.delenv("HALO_FAKES", raising=False)
    monkeypatch.setenv("META_API_KEY", "")
    assert client.get("/api/status").json() == {"meta_key": False}
    monkeypatch.setenv("META_API_KEY", "set")
    assert client.get("/api/status").json() == {"meta_key": True}
