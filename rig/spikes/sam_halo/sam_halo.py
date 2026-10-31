"""Spike: Halo mode on the hosted SAM 3.1 API (one speaking tile, no Meet, no screen).

Crops a 16:9 "speaking tile" out of a local clip's frames, sends each frame to
sam-3.1 (POST https://api.meta.ai/v1/responses, base64 image, one noun-phrase
prompt), parses the face box, draws the halo (name pill centred above the head,
the overlay's namePos rule) and measures latency, throughput, cost and how far a
held box drifts between SAM results.

    uv run --with pillow python rig/spikes/sam_halo/sam_halo.py --frames-dir <dir>

Reads META_API_KEY from .env (never printed). Writes results.json and a few
annotated PNGs to rig/spikes/sam_halo/out/. Every request costs $0.0025.
"""
import argparse
import base64
import io
import json
import math
import re
import statistics
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

URL = "https://api.meta.ai/v1/responses"
USD_PER_IMAGE = 2.50 / 1000  # dev.meta.ai/docs/pricing-rate-limits, checked 2026-10-31
TILE_W, TILE_H = 640, 360  # a typical Meet tile video size
BOX_RE = re.compile(r"<\|box;([^|]*)\|>")
OUT = Path(__file__).parent / "out"


def parse_boxes(text: str) -> list[dict]:
    """Every `<|box;k=v;...|>` record as a dict of floats (x1,y1,x2,y2,w,h[,c])."""
    return [{k: float(v) for k, v in (kv.split("=") for kv in m.split(";"))} for m in BOX_RE.findall(text)]


def best_face(boxes: list[dict]) -> list[float] | None:
    """Largest box as [x, y, w, h] in 0..1 of the frame (the faces.update shape). Speaking tile = one main face."""
    if not boxes:
        return None
    b = max(boxes, key=lambda b: (b["x2"] - b["x1"]) * (b["y2"] - b["y1"]))
    return [b["x1"] / b["w"], b["y1"] / b["h"], (b["x2"] - b["x1"]) / b["w"], (b["y2"] - b["y1"]) / b["h"]]


def name_pos(box: list[float], tile_w: int, tile_h: int) -> tuple[float, float]:
    """The overlay's Face-mode rule (overlay.ts layout): centre x, 6 px above the box top, floor 21 px."""
    return (box[0] + box[2] / 2) * tile_w, max(21.0, box[1] * tile_h - 6)


def load_key() -> str:
    for line in Path(".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("META_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"')
    raise SystemExit("META_API_KEY missing from .env")


def tile_jpeg(path: Path, crop: tuple[int, int, int, int]) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.open(path).convert("RGB").crop(crop).resize((TILE_W, TILE_H)).save(buf, "JPEG", quality=80)
    return buf.getvalue()


def call_sam(client, key: str, jpeg: bytes, prompt: str) -> tuple[float, str]:
    """One sam-3.1 image call. Returns (wall ms incl. base64, output text)."""
    t0 = time.perf_counter()
    body = {
        "model": "sam-3.1",
        "input": [{"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": prompt},
            {"type": "input_image", "image_url": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()},
        ]}],
        "metadata": {"mask_encoding": "one_bit", "include_confidence": "true"},
    }
    r = client.post(URL, json=body, headers={"Authorization": f"Bearer {key}"}, timeout=30)
    ms = (time.perf_counter() - t0) * 1000
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
    data = r.json()
    text = "".join(c.get("text", "") for o in data.get("output", []) for c in o.get("content", []) or [])
    return ms, text


def draw_halo(jpeg: bytes, box: list[float] | None, name: str, path: Path) -> None:
    from PIL import Image, ImageDraw

    img = Image.open(io.BytesIO(jpeg)).convert("RGB")
    d = ImageDraw.Draw(img)
    if box:
        d.rectangle([box[0] * TILE_W, box[1] * TILE_H, (box[0] + box[2]) * TILE_W, (box[1] + box[3]) * TILE_H],
                    outline=(120, 200, 255), width=1)  # debug only; the product never draws the box
        cx, by = name_pos(box, TILE_W, TILE_H)
        tw = d.textlength(name)
        pill = [cx - tw / 2 - 10, by - 22, cx + tw / 2 + 10, by]
        d.rounded_rectangle(pill, radius=11, fill=(20, 20, 24), outline=(0, 0, 0), width=2)
        d.text((cx - tw / 2, by - 17), name, fill=(255, 255, 255))
    img.save(path)


def pct(xs: list[float], p: float) -> float:
    return statistics.quantiles(xs, n=100, method="inclusive")[p - 1] if len(xs) > 1 else xs[0]


def main() -> None:
    import httpx

    ap = argparse.ArgumentParser()
    ap.add_argument("--frames-dir", required=True, type=Path)
    ap.add_argument("--crop", default="430,200,1070,560", help="tile crop x1,y1,x2,y2 in source pixels")
    ap.add_argument("--n", type=int, default=60, help="sequential frames for latency + alignment")
    ap.add_argument("--step", type=int, default=2, help="source frames between samples")
    ap.add_argument("--parallel", type=int, default=20, help="extra calls for the concurrency pass (0 = skip)")
    ap.add_argument("--name", default="Sara Haddad")
    ap.add_argument("--tile", default="640x360", help="tile size sent to SAM")
    ap.add_argument("--out", default="results.json")
    ap.add_argument("--sway", type=int, default=0, help="calls for the known-shift jitter test (0 = skip)")
    args = ap.parse_args()
    global TILE_W, TILE_H
    TILE_W, TILE_H = (int(v) for v in args.tile.split("x"))
    crop = tuple(int(v) for v in args.crop.split(","))
    frames = sorted(args.frames_dir.glob("*.jpg"), key=lambda p: int(p.stem))[::args.step][:args.n]
    key = load_key()
    OUT.mkdir(exist_ok=True)
    calls = 0
    res: dict = {"tile": f"{TILE_W}x{TILE_H}", "frames": len(frames), "step": args.step}

    with httpx.Client(http2=False) as client:
        jpegs = [tile_jpeg(p, crop) for p in frames]
        res["jpeg_kb_mean"] = round(statistics.mean(len(j) for j in jpegs) / 1024, 1)

        # 1. prompt check on the first frame
        res["prompts"] = {}
        for prompt in ("face", "head", "person"):
            ms, text = call_sam(client, key, jpegs[0], prompt)
            calls += 1
            boxes = parse_boxes(text)
            res["prompts"][prompt] = {"ms": round(ms), "n": len(boxes), "best": best_face(boxes),
                                      "conf": [b.get("c") for b in boxes]}
            draw_halo(jpegs[0], best_face(boxes), args.name, OUT / f"prompt_{prompt}_{TILE_W}.png")

        # 2. sequential: latency per frame + the box track used for the alignment numbers
        lat, track = [], []
        for i, jpeg in enumerate(jpegs):
            ms, text = call_sam(client, key, jpeg, "face")
            calls += 1
            lat.append(ms)
            track.append(best_face(parse_boxes(text)))
            if i % 15 == 0:
                draw_halo(jpeg, track[-1], args.name, OUT / f"halo_{TILE_W}_{i:03d}.png")
        res["seq"] = {"p50_ms": round(pct(lat, 50)), "p90_ms": round(pct(lat, 90)), "max_ms": round(max(lat)),
                      "fps_one_in_flight": round(1000 / statistics.mean(lat), 2),
                      "found": sum(b is not None for b in track)}

        # 3. concurrency: N calls with 4 in flight, does throughput scale?
        if args.parallel:
            todo = (jpegs * 2)[:args.parallel]
            t0 = time.perf_counter()
            with ThreadPoolExecutor(4) as ex:
                plat = [ms for ms, _ in ex.map(lambda j: call_sam(client, key, j, "face"), todo)]
            wall = time.perf_counter() - t0
            calls += len(todo)
            res["parallel4"] = {"fps": round(len(todo) / wall, 2), "p50_ms": round(pct(plat, 50)),
                                "p90_ms": round(pct(plat, 90))}

        # 4. sway: one still frame, crop window shifted by known px (a seated speaker's head sway).
        # Residual = |pill move - true move|: SAM's own jitter, the floor any hold/smoothing sits on.
        if args.sway:
            base = None
            resid = []
            for i in range(args.sway):
                dx, dy = round(12 * math.sin(i)), round(6 * math.cos(i))
                c = (crop[0] + dx, crop[1] + dy, crop[2] + dx, crop[3] + dy)
                box = best_face(parse_boxes(call_sam(client, key, tile_jpeg(frames[0], c), "face")[1]))
                calls += 1
                if not box:
                    continue
                sx, sy = TILE_W / (crop[2] - crop[0]), TILE_H / (crop[3] - crop[1])
                px, py = name_pos(box, TILE_W, TILE_H)
                if base is None:
                    base = (px + dx * sx, py + dy * sy)  # pill position in the unshifted frame
                else:
                    resid.append(abs(px + dx * sx - base[0]) + abs(py + dy * sy - base[1]))
            res["sway_jitter_L1_px"] = {"p50_px": round(pct(resid, 50), 1), "p90_px": round(pct(resid, 90), 1),
                                        "n": len(resid)}

    # 5. alignment: hold the last box for k samples, measure the name-pill error vs the fresh box
    src_fps = 30  # assumed source rate of the clip; drift numbers scale with it
    align = {}
    for k in (1, 2, 3, 5, 10, 15):
        errs = [abs(name_pos(track[i - k], TILE_W, TILE_H)[0] - name_pos(track[i], TILE_W, TILE_H)[0])
                + abs(name_pos(track[i - k], TILE_W, TILE_H)[1] - name_pos(track[i], TILE_W, TILE_H)[1])
                for i in range(k, len(track)) if track[i] and track[i - k]]
        if errs:
            align[f"hold_{k * args.step / src_fps:.2f}s"] = {"p50_px": round(pct(errs, 50), 1),
                                                           "p90_px": round(pct(errs, 90), 1)}
    res["align_name_pill_L1_px"] = align
    res["calls"] = calls
    res["usd_spent"] = round(calls * USD_PER_IMAGE, 4)
    res["usd_per_meeting_min"] = {f"{f}fps": round(f * 60 * USD_PER_IMAGE, 3) for f in (1, 2, 5, 10)}
    (OUT / args.out).write_text(json.dumps(res, indent=2))
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
