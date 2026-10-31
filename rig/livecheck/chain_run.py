"""Real-engine backend chain, no browser.

One clip plays the hub's part over the real socket (POST /pair, /ws with the
extension Origin, pair.hello, envelopes with ACKs, binary kind=1 audio) as the
TAB or MIC stream -> Gateway -> real Voice -> Correlator -> Insight (real LLM)
-> points back on the socket -> meeting.ended -> ring 2 (Event Store,
Classifier, Notes Builder, Notes Service over real HTTP).

Frames leave with browser-like jitter (small noise plus stalls released as
bursts) to exercise the Gateway queues and the transcriber's wall-clock
pacing. Keys come from the repo-root .env (never printed). Real engines cost
money: Voice bills the audio fed plus the silence tail.

  uv run --with av python -u rig/livecheck/chain_run.py CLIP --stream tab --secs 120 \
      [--port 8793] [--ref ref.txt] [--no-jitter]

Outputs (page.json, hyp.txt, summary.json) go to a temp dir outside the repo:
recordings of real people and their transcripts are never committed.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import random
import re
import sqlite3
import sys
import tempfile
import time
import unicodedata
import urllib.request
import uuid
from pathlib import Path
from typing import Any

RATE = 16000
FRAME_BYTES = 3200  # 100 ms PCM16 mono, the hub's frame
GOLD = Path(__file__).resolve().parents[2] / "contracts" / "golden"
T0 = time.perf_counter()


def log(tag: str, msg: str) -> None:
    print(f"{time.perf_counter() - T0:6.1f}s {tag:<16} {msg}", flush=True)


def load_pcm(path: str, secs: int) -> bytes:
    import av  # only the rig needs it: `uv run --with av`
    pcm = bytearray()
    res = av.AudioResampler(format="s16", layout="mono", rate=RATE)
    with av.open(path) as c:
        for frame in c.decode(audio=0):
            for out in res.resample(frame):
                pcm += bytes(out.planes[0])[: out.samples * 2]
            if len(pcm) >= secs * RATE * 2:
                break
    return bytes(pcm[: secs * RATE * 2])


def jitter_schedule(n: int, rng: random.Random, enabled: bool) -> list[float]:
    """Send offset (s) of each 100 ms frame: noise + stalls released as bursts."""
    due = [i * 0.1 for i in range(n)]
    if not enabled:
        return due
    due = [t + rng.gauss(0, 0.015) for t in due]
    i = 0
    while i < n:
        if rng.random() < 0.02:  # stall of 3-10 frames, released together
            k = rng.randint(3, 10)
            release = (i + k) * 0.1
            for j in range(i, min(i + k, n)):
                due[j] = release
            i += k
        i += 1
    out, hi = [], 0.0
    for t in due:  # a socket sends in order
        hi = max(hi, t)
        out.append(hi)
    return out


# -- transcript scoring (same normalisation as the day-0 arabic-asr probe) --
_AR_DIAC = re.compile("[ؐ-ًؚ-ٰٟۖ-ۭـ]")
_AR_MAP = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ة": "ه"})


def norm_words(s: str) -> list[str]:
    s = _AR_DIAC.sub("", unicodedata.normalize("NFKC", s)).translate(_AR_MAP).lower()
    return "".join(" " if unicodedata.category(c)[0] in "PS" else c for c in s).split()


def wer(ref: list[str], hyp: list[str]) -> float:
    # ponytail: O(n*m) pure Python, fine for a few-minute clip
    prev = list(range(len(hyp) + 1))
    for i, x in enumerate(ref, 1):
        cur = [i]
        for j, y in enumerate(hyp, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1] / max(1, len(ref))


def golden(name: str, meetingid: str | None, data: dict[str, Any] | None = None) -> dict[str, Any]:
    e = json.loads((GOLD / f"{name}.json").read_text(encoding="utf-8"))
    e.update(id=str(uuid.uuid4()), source="halo/chain-run", meetingid=meetingid)
    if data is not None:
        e["data"] = data
    return e


def http(port: int, path: str, body: dict[str, Any] | None = None) -> tuple[int, bytes]:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def pct(xs: list[float], p: float) -> float | None:
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(len(xs) * p))], 2) if xs else None


class Warnings(logging.Handler):
    """Every halo.* warning, printed and kept for the summary."""

    def __init__(self) -> None:
        super().__init__(logging.WARNING)
        self.records: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        exc = record.exc_info[1] if record.exc_info else None
        msg = f"{record.name}: {record.getMessage()}{f' ({exc!r})' if exc else ''}"[:240]
        self.records.append(msg)
        log("WARN", msg)


async def run(args: argparse.Namespace, data_dir: Path) -> dict[str, Any]:
    import uvicorn
    import websockets
    from halo.app import app  # loads .env, then builds the app on HALO_DATA_DIR
    from jsonschema import Draft202012Validator  # type: ignore[import-untyped]

    from contracts.binary import MIC, TAB, pack_audio

    warns = Warnings()
    logging.getLogger("halo").addHandler(warns)
    logging.getLogger("halo").propagate = False

    pcm = load_pcm(args.clip, args.secs)
    n = (len(pcm) + FRAME_BYTES - 1) // FRAME_BYTES
    log("clip", f"{len(pcm) / 32000:.1f}s as {args.stream} stream, jitter={not args.no_jitter}, data={data_dir}")
    bus = app.state.bus
    mid = str(uuid.uuid4())
    t0_ms = int(time.time() * 1000)
    seen: dict[str, int] = {}
    lat: dict[str, list[float]] = {"asr": [], "insight": [], "e2e": []}
    state: dict[str, float] = {"start": 0.0, "last_final": 0.0}
    attrib_wall: dict[str, float] = {}
    end_wall: dict[str, float] = {}
    finals: list[dict[str, Any]] = []
    turns: list[dict[str, Any]] = []
    points: dict[str, dict[str, Any]] = {}
    tagged: set[str] = set()
    asr_states: dict[str, int] = {}

    def captured(ts_ms: int) -> float:
        """Wall time the browser captured the audio at ts_ms (real time)."""
        return state["start"] + (ts_ms - t0_ms) / 1000

    # -- internal bus taps (these types never reach the socket) --
    async def on_final(e: dict[str, Any]) -> None:
        d = e["data"]
        seen["transcript.final"] = seen.get("transcript.final", 0) + 1
        now = time.perf_counter()
        state["last_final"] = now
        lat["asr"].append(now - captured(d["ts_end_ms"]))
        end_wall[d["turn_id"]] = captured(d["ts_end_ms"])
        finals.append(d)
        log("final", f"[{d['stream']}/{d['speaker']}/{d['lang']}] {d['ts_start_ms'] - t0_ms}-"
                     f"{d['ts_end_ms'] - t0_ms}ms {d['text'][:70]}")

    async def on_attr(e: dict[str, Any]) -> None:
        d = e["data"]
        seen["turn.attributed"] = seen.get("turn.attributed", 0) + 1
        attrib_wall[d["turn_id"]] = time.perf_counter()
        turns.append(d)
        log("attributed", f"{d['name']} {d['attribution']} overlap={d['overlap']}")

    async def on_any(e: dict[str, Any]) -> None:
        seen[e["type"]] = seen.get(e["type"], 0) + 1
        log(e["type"], json.dumps(e["data"], ensure_ascii=False)[:120])

    bus.subscribe("transcript.final", on_final)
    bus.subscribe("turn.attributed", on_attr)
    for t in ("llm.health", "system.status", "speaker.mapped"):
        bus.subscribe(t, on_any)

    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=args.port,
                                           log_level="warning", lifespan="on"))
    serve = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.1)

    # -- the hub: pair, then one socket for envelopes + audio --
    st, body = await asyncio.to_thread(http, args.port, "/pair",
                                       {"code": app.state.gateway.pairing.current_code})
    assert st == 200, f"/pair -> {st} {body[:200]!r}"
    token = json.loads(body)["token"]
    ws = await websockets.connect(f"ws://127.0.0.1:{args.port}/ws",
                                  origin=app.state.gateway.expected_origin)  # type: ignore[arg-type]
    hello = golden("pair.hello", None, {"token": token, "ext_version": "0.1.0"})
    await ws.send(json.dumps(hello))
    reply = json.loads(await ws.recv())
    log("pair", reply["type"])
    assert reply["type"] == "pair.ok", reply

    acks: dict[str, asyncio.Future[dict[str, Any]]] = {}

    async def reader() -> None:
        async for raw in ws:
            msg = json.loads(raw)
            if "ack_of" in msg:
                fut = acks.pop(msg["ack_of"], None)
                if fut and not fut.done():
                    fut.set_result(msg)
                continue
            kind, d = msg.get("type"), msg.get("data", {})
            seen["ws:" + str(kind)] = seen.get("ws:" + str(kind), 0) + 1
            now = time.perf_counter()
            if kind == "points.upsert":
                fresh = d["point_id"] not in points
                points[d["point_id"]] = d
                tid = (d.get("turn_ids") or [None])[-1]
                if fresh and tid in attrib_wall:
                    lat["insight"].append(now - attrib_wall[tid])
                if fresh and tid in end_wall:
                    lat["e2e"].append(now - end_wall[tid])
                log("ws:point", f"{d['speaker_name']} {d['kind']}/{d['urgency']} action={d['is_action']} "
                                f"[{d['engine']}] {d['text'][:70]}")
            elif kind == "tags.set":
                tagged.add(d["target_id"])
                log("ws:tags", f"{d['source']} {d.get('kind')}/{d.get('urgency')} [{d.get('model')}]")
            else:
                log("ws:" + str(kind), json.dumps(d, ensure_ascii=False)[:120])

    read_task = asyncio.create_task(reader())

    ack_s: dict[str, float] = {}

    async def send(e: dict[str, Any]) -> dict[str, Any]:
        """Send one envelope; the hub resends after 2 s, so a slow ACK is a finding."""
        fut = asyncio.get_running_loop().create_future()
        acks[e["id"]] = fut
        sent = time.perf_counter()
        await ws.send(json.dumps(e, ensure_ascii=False))
        ack = await asyncio.wait_for(fut, timeout=90)
        ack_s[e["type"]] = round(time.perf_counter() - sent, 2)
        log("ack", f"{e['type']} -> {ack['status']} in {ack_s[e['type']]}s {ack.get('error') or ''}")
        return ack

    other = "spaces/x/devices/2"
    started = golden("meeting.started", mid)
    started["data"].update(meeting_id=mid, t0_ms=t0_ms)
    tiles = golden("tiles.snapshot", mid)
    tiles["data"]["tiles"].append({**tiles["data"]["tiles"][0], "tile_id": other, "name": "Omar",
                                   "is_self": False, "rect": [640, 0, 1280, 360]})
    for e in (started, golden("meeting.context", mid), tiles):
        assert (await send(e))["status"] == "ok", e["type"]
    if args.stream == "tab":
        await send(golden("speaker.active", mid, {"tile_id": other, "speaking": True, "ts_ms": t0_ms}))
    await asyncio.sleep(2)  # Voice sessions open

    # Rig-only probe: wall-clock silence the session pads in while frames
    # stall. Pads before the last frame shift Voice's offsets off the
    # browser clock (the session maps ts = anchor + engine offset).
    pads = {"ms": 0, "before_last_frame_ms": 0}
    session = app.state.transcriber._sessions[args.stream]
    real_silence = session.send_silence

    async def counted_silence(ms: int = 100) -> None:
        if session.anchor_ms is not None:
            pads["ms"] += ms
            if not state.get("fed"):
                pads["before_last_frame_ms"] += ms
        await real_silence(ms)

    session.send_silence = counted_silence

    async def sample_asr() -> None:
        while True:
            s = str(bus.health().get("asr"))
            asr_states[s] = asr_states.get(s, 0) + 1
            await asyncio.sleep(1)

    sampler = asyncio.create_task(sample_asr())
    stream = TAB if args.stream == "tab" else MIC
    sched = jitter_schedule(n, random.Random(args.seed), not args.no_jitter)
    state["start"] = start = time.perf_counter()
    for seq in range(n):
        wait = start + sched[seq] - time.perf_counter()
        if wait > 0:
            await asyncio.sleep(wait)
        await ws.send(pack_audio(stream, seq, t0_ms + seq * 100, pcm[seq * FRAME_BYTES:(seq + 1) * FRAME_BYTES]))
    fed_s = time.perf_counter() - start
    state["fed"] = 1.0
    log("audio", f"sent {n} frames ({n / 10:.0f}s audio) in {fed_s:.1f}s wall")

    # Tail: the last pause soft-cuts, Insight drains its held turns.
    deadline = time.perf_counter() + 30
    while time.perf_counter() < deadline:
        quiet = time.perf_counter() - max(state["last_final"], start + fed_s)
        if quiet > 6 and not any(app.state.insight._held.values()):
            break
        await asyncio.sleep(0.5)
    await asyncio.sleep(3)  # last Insight call in flight
    tail_s = time.perf_counter() - start - fed_s
    gw = bus.health().get("gateway")
    log("health", json.dumps(bus.health())[:300])

    # -- ring 2 --
    ended_at = time.perf_counter()
    await send(golden("meeting.ended", mid))
    while time.perf_counter() - ended_at < 60 and not seen.get("ws:notes.ready"):
        await asyncio.sleep(0.5)
    notes_s = time.perf_counter() - ended_at if seen.get("ws:notes.ready") else None
    # The Classifier ticks every 10 s: give the last points one tick.
    while time.perf_counter() - ended_at < 12 and not set(points) <= tagged:
        await asyncio.sleep(0.5)

    con = sqlite3.connect(f"file:{data_dir / 'events.sqlite'}?mode=ro", uri=True)
    events = dict(con.execute("select type, count(*) from events where meetingid = ? or meetingid is null"
                              " group by type", (mid,)).fetchall())
    ended_row = con.execute("select ended_at, reason from meetings where meeting_id = ?", (mid,)).fetchone()
    views = {v: con.execute(f"select count(*) from {v}").fetchone()[0]
             for v in ("points_current", "tags_effective")}
    con.close()
    log("store", f"events={events} meeting_ended={ended_row} views={views}")

    st, body = await asyncio.to_thread(http, args.port, f"/api/meetings/{mid}")
    page = json.loads(body) if st == 200 else {}
    schema = json.loads((GOLD.parent / "meeting-page.schema.json").read_text(encoding="utf-8"))
    page_errors = [e.message for e in Draft202012Validator(schema).iter_errors(page)][:5]
    log("api", f"{st} people={[p['name'] for p in page.get('people', [])]} points={len(page.get('points', []))} "
               f"actions={len(page.get('actions', []))} lines={len(page.get('transcript_lines', []))} "
               f"degraded={page.get('meeting', {}).get('degraded')} schema_errors={page_errors}")
    st_html, html = await asyncio.to_thread(http, args.port, f"/notes/{mid}")
    st_list, lst = await asyncio.to_thread(http, args.port, "/api/meetings")
    listed = any(m["meeting_id"] == mid for m in json.loads(lst)) if st_list == 200 else False
    retag: dict[str, Any] = {}
    if page.get("points"):  # one user re-tag: the user always wins
        pid = page["points"][0]["point_id"]
        st_tag, _ = await asyncio.to_thread(http, args.port, "/api/tags",
                                            {"target": "point", "target_id": pid, "kind": "decision"})
        _, again = await asyncio.to_thread(http, args.port, f"/api/meetings/{mid}")
        after = next(p for p in json.loads(again)["points"] if p["point_id"] == pid)
        retag = {"status": st_tag, "kind_after": after["kind"]}
    if page.get("actions"):  # the action re-tag menu resolves the page's action_id
        st_act, _ = await asyncio.to_thread(http, args.port, "/api/tags", {
            "target": "action", "target_id": page["actions"][0]["action_id"], "urgency": "later"})
        retag["action_status"] = st_act
    log("http", f"/notes -> {st_html} ({len(html)} B), list has meeting={listed}, retag={retag}")

    hyp = " ".join(d["text"] for d in sorted(finals, key=lambda d: d["ts_start_ms"]))
    (data_dir / "page.json").write_text(json.dumps(page, ensure_ascii=False, indent=1), encoding="utf-8")
    (data_dir / "hyp.txt").write_text(hyp, encoding="utf-8")
    accuracy = None
    if args.ref:
        ref = norm_words(Path(args.ref).read_text(encoding="utf-8"))
        accuracy = {"wer": round(wer(ref, norm_words(hyp)), 3), "ref_words": len(ref),
                    "hyp_words": len(norm_words(hyp))}

    def count(xs: list[dict[str, Any]], key: str) -> dict[str, int]:
        out: dict[str, int] = {}
        for x in xs:
            out[str(x.get(key))] = out.get(str(x.get(key)), 0) + 1
        return out

    summary = {
        "clip_s": round(len(pcm) / 32000, 1), "stream": args.stream, "jitter": not args.no_jitter,
        "voice_audio_s": round(fed_s + tail_s, 1),
        "seen": seen, "asr_health_samples": asr_states, "gateway": gw, "voice_pads": pads,
        "latency_s": {k: {"n": len(v), "p50": pct(v, .5), "p90": pct(v, .9), "max": pct(v, 1)}
                      for k, v in lat.items()},
        "speakers": count(finals, "speaker"), "langs": count(finals, "lang"),
        "attributed": count(turns, "name"), "attribution": count(turns, "attribution"),
        "points_by_speaker": count(list(points.values()), "speaker_name"),
        "points_by_kind": count(list(points.values()), "kind"),
        "points_by_engine": count(list(points.values()), "engine"),
        "points_untagged": len(set(points) - tagged),
        "notes_ready_s": round(notes_s, 1) if notes_s is not None else None, "ack_s": ack_s,
        "page": {"status": st, "schema_errors": page_errors, "people": len(page.get("people", [])),
                 "points": len(page.get("points", [])), "actions": len(page.get("actions", [])),
                 "action_status": count(page.get("actions", []), "status"),
                 "lines": len(page.get("transcript_lines", [])),
                 "degraded": page.get("meeting", {}).get("degraded")},
        "notes_html": st_html, "listed": listed, "retag": retag,
        "accuracy": accuracy, "warnings": len(warns.records),
        "warning_kinds": sorted({re.sub(r"[0-9a-f-]{36}|\d+", "#", w)[:90] for w in warns.records}),
    }
    (data_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    log("summary", json.dumps(summary, ensure_ascii=False))
    sampler.cancel()
    await ws.close()
    read_task.cancel()
    server.should_exit = True
    await serve
    return summary


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("clip")
    ap.add_argument("--stream", choices=["tab", "mic"], default="tab")
    ap.add_argument("--secs", type=int, default=120, help="cap on clip seconds fed to Voice")
    ap.add_argument("--port", type=int, default=8793, help="never 8765 (the live backend)")
    ap.add_argument("--data", default="", help="data dir (default: a fresh temp dir)")
    ap.add_argument("--ref", default="", help="reference transcript for WER")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--no-jitter", action="store_true")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]  # Arabic lines on a cp1252 console
    if args.port == 8765:
        ap.error("port 8765 is the live backend")
    data_dir = Path(args.data or tempfile.mkdtemp(prefix="halo-chain-"))
    os.environ["HALO_DATA_DIR"] = str(data_dir)  # before halo.app builds the store
    asyncio.run(run(args, data_dir))


if __name__ == "__main__":
    main()
