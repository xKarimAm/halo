"""HTTP front-door tests (PLAN cases 4/4b + the issue #5 ruling).

`POST /pair {code} -> 200 {token}`; wrong/used code 401; malformed 400.
`GET /pair` serves the pairing page. The Host middleware rejects foreign
hosts. The Origin rule is unit-tested here; the socket loop itself rides the
same `SocketSession` covered in `test_session.py`.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
from halo.bus import Bus
from halo.gateway.gateway import Gateway, host_check, router


def make_client(tmp_path, **gateway_kwargs):
    app = FastAPI()
    app.state.gateway = Gateway(Bus(), data_dir=tmp_path, extension_id="test-id", **gateway_kwargs)
    app.include_router(router)
    app.middleware("http")(host_check)
    client = TestClient(app)
    client.headers["host"] = "127.0.0.1:8765"
    return client, app


def test_pair_page_and_post_ruling(tmp_path):
    client, app = make_client(tmp_path)
    page = client.get("/pair")
    assert page.status_code == 200 and "Halo pairing" in page.text

    code = app.state.gateway.pairing.current_code
    ok = client.post("/pair", json={"code": code})
    assert ok.status_code == 200 and isinstance(ok.json()["token"], str)
    assert client.post("/pair", json={"code": code}).status_code == 401  # used
    wrong = "000001" if code != "000001" else "000002"
    assert client.post("/pair", json={"code": wrong}).status_code == 401
    assert client.post("/pair", json={"code": "12"}).status_code == 400
    assert client.post("/pair", json={}).status_code == 400
    assert client.post("/pair", content="{oops",
                       headers={"Content-Type": "application/json"}).status_code == 400


def test_host_middleware_rejects_foreign_hosts(tmp_path):
    client, _ = make_client(tmp_path)
    assert client.get("/pair", headers={"host": "evil.example:8765"}).status_code == 400
    assert client.get("/pair", headers={"host": "127.0.0.1:8765"}).status_code == 200


def test_origin_rule(tmp_path):
    _, app = make_client(tmp_path)
    gateway: Gateway = app.state.gateway
    assert gateway.origin_ok("chrome-extension://test-id") is True
    assert gateway.origin_ok("chrome-extension://other-id") is False
    assert gateway.origin_ok(None) is False
    assert gateway.origin_ok("") is False


def test_origin_rule_without_pinned_id(tmp_path):
    _, app = make_client(tmp_path)
    gateway: Gateway = app.state.gateway
    gateway.extension_id = ""
    assert gateway.origin_ok("chrome-extension://anything") is True
    assert gateway.origin_ok("https://evil.example") is False
    assert gateway.origin_ok(None) is False
