"""Halo mode face worker: SAM 3.1 (Meta, open weights) on the local GPU.

The extension's hub POSTs the speaking tile's frame (JPEG) to
http://127.0.0.1:8766/faces; the reply is the `faces.update` face shape
(box and head anchor in 0..1 of the frame, conf) or null. Frames stay in
memory on this PC and are never saved. Without this worker the Overlay
stays in Frame mode.

Run it with the SAM venv (torch + transformers + the cached weights):
    "E:\\Meta Hackathon\\Planning\\day0\\sam-fps\\.venv\\Scripts\\python.exe" packaging/sam_worker.py

Measured 2026-11-02 on the 3080 Ti: ~220 ms per 480 px frame, 2 GB VRAM.
"""

from __future__ import annotations

import io
import json
import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

log = logging.getLogger("halo.sam_worker")

PORT = 8766
REPO = "unsloth/sam3.1"  # Meta's SAM 3.1 weights, ungated mirror for transformers' Sam3Model
PROMPT = "face"
MIN_SCORE = 0.5
MAX_BODY = 2_000_000


def pick_face(boxes: list[list[float]], scores: list[float], w: int, h: int) -> dict[str, Any] | None:
    """The largest confident face (the speaker, not a face in the background),
    as the faces.update face: box [x, y, w, h] and head_anchor in 0..1."""
    found = [(b, s) for b, s in zip(boxes, scores, strict=True) if s >= MIN_SCORE]
    if not found or w <= 0 or h <= 0:
        return None
    (x1, y1, x2, y2), score = max(found, key=lambda bs: (bs[0][2] - bs[0][0]) * (bs[0][3] - bs[0][1]))
    x1, x2 = max(0.0, x1) / w, min(float(w), x2) / w
    y1, y2 = max(0.0, y1) / h, min(float(h), y2) / h
    return {"box": [round(x1, 4), round(y1, 4), round(x2 - x1, 4), round(y2 - y1, 4)],
            "head_anchor": [round((x1 + x2) / 2, 4), round(y1, 4)],
            "conf": round(float(score), 3)}


class SamFaces:
    """Loads SAM 3.1 once; detect() is serialised (one GPU)."""

    def __init__(self) -> None:
        import torch  # lazy: tests and the backend venv never need torch
        from transformers import Sam3Model, Sam3Processor

        self._torch = torch
        self._processor = Sam3Processor.from_pretrained(REPO)
        self._model = Sam3Model.from_pretrained(REPO, torch_dtype=torch.bfloat16).to("cuda").eval()
        self._lock = threading.Lock()

    def detect(self, jpeg: bytes) -> dict[str, Any] | None:
        from PIL import Image

        image = Image.open(io.BytesIO(jpeg)).convert("RGB")
        w, h = image.size
        torch = self._torch
        with self._lock, torch.inference_mode():
            batch = self._processor(images=[image], text=[PROMPT], return_tensors="pt").to("cuda")
            batch = {k: (v.to(torch.bfloat16) if v.is_floating_point() else v) for k, v in batch.items()}
            out = self._model(**batch)
            res = self._processor.post_process_instance_segmentation(
                out, threshold=MIN_SCORE, mask_threshold=0.5, target_sizes=[(h, w)])[0]
        return pick_face([[float(v) for v in b] for b in res["boxes"]],
                         [float(s) for s in res["scores"]], w, h)


def make_handler(detector: Any) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def _reply(self, code: int, body: Any) -> None:
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:
            self._reply(200, {"ok": True, "engine": "sam"}) if self.path == "/health" else self._reply(404, {})

        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length") or 0)
            if self.path != "/faces" or not 0 < length <= MAX_BODY:
                self._reply(400, {"error": "POST a JPEG to /faces"})
                return
            try:
                face = detector.detect(self.rfile.read(length))
            except Exception as exc:  # noqa: BLE001 (a bad frame never kills the worker)
                log.warning("sam detect failed: %s", exc)
                self._reply(500, {"error": "detect failed"})
                return
            self._reply(200, {"face": face})

        def log_message(self, *_: Any) -> None:  # quiet: ~5 requests a second
            return

    return Handler


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    detector = SamFaces()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), make_handler(detector))
    print(f"Halo SAM worker on http://127.0.0.1:{PORT} (SAM 3.1, prompt '{PROMPT}')", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
