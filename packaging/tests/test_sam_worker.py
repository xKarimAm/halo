"""SAM worker: face pick + HTTP shape, with a fake detector (no torch, no GPU)."""

from __future__ import annotations

import importlib.util
import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

# By path: "packaging" is also the name of an installed library.
_spec = importlib.util.spec_from_file_location("sam_worker", Path(__file__).parents[1] / "sam_worker.py")
sam_worker = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sam_worker)
make_handler, pick_face = sam_worker.make_handler, sam_worker.pick_face


def test_pick_face_takes_the_largest_confident_face_in_0_to_1():
    boxes = [[10, 10, 20, 20], [100, 50, 200, 200], [0, 0, 300, 180]]
    face = pick_face(boxes, [0.9, 0.8, 0.3], w=320, h=180)  # the 0.3 box is too unsure; y2 clips to the frame
    assert face == {"box": [0.3125, 0.2778, 0.3125, 0.7222], "head_anchor": [0.4688, 0.2778], "conf": 0.8}
    assert pick_face([], [], 320, 180) is None
    assert pick_face([[0, 0, 5, 5]], [0.2], 320, 180) is None


def test_http_faces_and_health():
    class Fake:
        def detect(self, jpeg: bytes):
            if jpeg == b"bad":
                raise ValueError("not a jpeg")
            return {"box": [0.1, 0.1, 0.2, 0.3], "head_anchor": [0.2, 0.1], "conf": 0.9}

    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(Fake()))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        def post(body: bytes, **headers: str):
            req = urllib.request.Request(base + "/faces", data=body, method="POST",
                                         headers={"Content-Type": "image/jpeg", **headers})
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, json.loads(r.read())

        assert post(b"jpeg")[1]["face"]["conf"] == 0.9
        try:
            post(b"bad")
            raise AssertionError("expected 500")
        except urllib.error.HTTPError as err:
            assert err.code == 500
        assert post(b"jpeg", Origin="chrome-extension://halo")[1]["face"]["conf"] == 0.9
        for bad in ({"Origin": "https://evil.example"}, {"Content-Type": "text/plain"}):
            try:
                post(b"jpeg", **bad)
                raise AssertionError(f"expected 403 for {bad}")
            except urllib.error.HTTPError as err:
                assert err.code == 403
        with urllib.request.urlopen(base + "/health", timeout=5) as r:
            assert json.loads(r.read()) == {"ok": True, "engine": "sam"}
    finally:
        server.shutdown()
