"""Joined thin run (verification gate 2): real backend + fakes + built
extension on the Fake Meet page + Replayer Mode A, end to end.

    uv run python -m rig.replayer.joined

Starts the backend with HALO_FAKES=1 and the fake engines, loads the
built extension in Playwright (rig/fake_meet/tests/joined.spec.js does
pair + Start there), replays a fixture bound to the hub's meeting id
through the real Gateway (Mode A over a paired WebSocket), then asserts:
transcript.final -> turn.attributed -> points.upsert in events.sqlite
(the golden checker), p90 pause->point < 4 s, and a bubble on the right
tile in the page. Everything lives under one temp dir; nothing is kept.
"""

from __future__ import annotations

import json
import math
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
from pathlib import Path

from halo.gateway.gateway import PINNED_EXTENSION_ID

from rig.replayer.checker import check
from rig.replayer.fixture import load_fixture
from rig.replayer.mode_a import ModeA

ROOT = Path(__file__).resolve().parents[2]
BACKEND_PORT = 8765
FAKES_PORT = 18777
MEET_PORT = 18778
SPEAKER_TILE = "spaces/x/devices/2"  # Layla in the Fake Meet fixture

TURNS = [
    {"stream": "tab", "speaker": "A", "text": "Launch moves to Nov 12 if payments QA clears",
     "lang": "en", "ts_start_ms": 1000, "ts_end_ms": 1900},
    {"stream": "tab", "speaker": "A", "text": "Beta cohort grows to twenty percent on Friday",
     "lang": "en", "ts_start_ms": 4500, "ts_end_ms": 5400},
    {"stream": "tab", "speaker": "A", "text": "We keep the address form in version two point one",
     "lang": "en", "ts_start_ms": 8000, "ts_end_ms": 8900},
]
POINTS = [
    {"match": "Launch moves", "response": {"kind": "decision", "text": "Launch moves to Nov 12",
     "quote": TURNS[0]["text"], "rank": 1, "urgency": "medium", "is_action": False}},
    {"match": "Beta cohort", "response": {"kind": "point", "text": "Beta cohort grows to 20% on Friday",
     "quote": TURNS[1]["text"], "rank": 1, "urgency": "medium", "is_action": False}},
    {"match": "address form", "response": {"kind": "point", "text": "Address form stays in v2.1",
     "quote": TURNS[2]["text"], "rank": 1, "urgency": "later", "is_action": False}},
]
TILES = [
    {"tile_id": "spaces/x/devices/1", "name": "Karim Amer", "is_self": True,
     "rect": [8, 8, 400, 225], "video_w": 640, "video_h": 360, "fit": "cover", "captions_rect": None},
    {"tile_id": SPEAKER_TILE, "name": "ليلى حسن", "is_self": False,
     "rect": [416, 8, 400, 225], "video_w": 640, "video_h": 360, "fit": "cover", "captions_rect": None},
    {"tile_id": "spaces/x/devices/3", "name": "Sam Lee", "is_self": False,
     "rect": [8, 241, 400, 225], "video_w": 640, "video_h": 360, "fit": "cover", "captions_rect": None},
]


def _env(n: int, type_: str, offset: int, meeting: str, t0: int, data: dict) -> dict:
    return {
        "specversion": "1.0", "id": f"00000000-0000-4000-8000-{n:012d}", "type": type_,
        "source": "halo/replayer", "time": "2026-10-31T09:00:00Z", "meetingid": meeting,
        "datacontenttype": "application/json", "ts_ms": offset, "data": data,
    }


def build_base_fixture(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    (root / "asr_script.jsonl").write_text(
        "\n".join(json.dumps(t) for t in TURNS), encoding="utf-8")
    (root / "llm_script.jsonl").write_text(
        "\n".join(json.dumps(p) for p in POINTS), encoding="utf-8")
    (root / "tab.pcm").write_bytes(b"\x00\x00" * 1600 * 110)  # 11 s silence
    (root / "mic.pcm").write_bytes(b"\x00\x00" * 1600 * 20)


def build_fixture(root: Path, meeting: str, t0: int) -> None:
    build_base_fixture(root)
    envelopes = [
        _env(1, "meeting.started", 0, meeting, t0, {
            "meeting_id": meeting, "platform": "meet", "meeting_code": "meet",
            "t0_ms": t0, "self_name": "Karim Amer"}),
        _env(2, "tiles.snapshot", 100, meeting, t0, {"tiles": TILES}),
        _env(3, "meeting.context", 150, meeting, t0, {
            "subject": "Joined gate", "agenda": [], "roles": [], "viewer_lang": "en"}),
        _env(4, "speaker.active", 900, meeting, t0, {
            "tile_id": SPEAKER_TILE, "speaking": True, "ts_ms": t0 + 900}),
    ]
    (root / "envelopes.jsonl").write_text(
        "\n".join(json.dumps(e) for e in envelopes), encoding="utf-8")
    expected = [{"type": "meeting.started", "tile_id": None, "ts_ms": t0}]
    for turn, point in zip(TURNS, POINTS):  # actual order: final, attributed, point
        expected.append({"type": "transcript.final", "tile_id": None,
                         "ts_ms": t0 + turn["ts_start_ms"], "text": turn["text"]})
        expected.append({"type": "turn.attributed", "tile_id": SPEAKER_TILE,
                         "ts_ms": t0 + turn["ts_start_ms"], "text": turn["text"]})
        expected.append({"type": "points.upsert", "tile_id": SPEAKER_TILE,
                         "text": point["response"]["text"]})
    (root / "expected.jsonl").write_text(
        "\n".join(json.dumps(e) for e in expected), encoding="utf-8")
    (root / "meta.json").write_text(json.dumps(
        {"t0_ms": t0, "tiles": [], "roles": {}}), encoding="utf-8")
    (root / "faces.jsonl").write_text("", encoding="utf-8")


def read_events(data_dir: Path) -> list[dict]:
    db = data_dir / "events.sqlite"
    if not db.exists():
        return []
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
    try:
        rows = con.execute(
            "SELECT id, type, time, meetingid, data FROM events ORDER BY seq").fetchall()
    except sqlite3.Error:
        return []
    finally:
        con.close()
    return [{"id": r[0], "type": r[1], "time": r[2], "meetingid": r[3],
             "data": json.loads(r[4])} for r in rows]


def p90(values: list[float]) -> float:
    ordered = sorted(values)
    return ordered[max(0, math.ceil(0.9 * len(ordered)) - 1)]


class SyncTransport:
    """Mode A transport over a real paired Gateway WebSocket."""

    def __init__(self, token: str):
        from websockets.sync.client import connect

        self.ws = connect(f"ws://127.0.0.1:{BACKEND_PORT}/ws",
                          additional_headers={"Origin": f"chrome-extension://{PINNED_EXTENSION_ID}"})
        hello = {
            "specversion": "1.0", "id": str(uuid.uuid4()), "type": "pair.hello",
            "source": "halo/replayer", "time": "2026-10-31T09:00:00Z", "meetingid": None,
            "datacontenttype": "application/json",
            "data": {"token": token, "ext_version": "joined"},
        }
        self.ws.send(json.dumps(hello))
        reply = json.loads(self.ws.recv(timeout=15))
        if reply.get("type") != "pair.ok":
            raise RuntimeError(f"pairing rejected: {reply}")

    def send_envelope(self, env: dict) -> dict:
        self.ws.send(json.dumps(env))
        while True:
            reply = json.loads(self.ws.recv(timeout=30))
            if reply.get("ack_of") == env["id"]:
                return reply

    def send_binary(self, frame: bytes) -> None:
        self.ws.send(frame)

    def close(self) -> None:
        self.ws.close()


def _wait(predicate, timeout: float, what: str):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.25)
    raise TimeoutError(f"timed out waiting for {what}")


def _http_json(url: str, payload: dict | None = None) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read() or b"{}")


class JoinedRun:
    def __init__(self) -> None:
        self.work = Path(tempfile.mkdtemp(prefix="halo-joined-"))
        self.data_dir = self.work / "data"
        self.fixture_dir = self.work / "fixture"
        self.signal_dir = self.work / "signal"
        for d in (self.data_dir, self.fixture_dir, self.signal_dir):
            d.mkdir(parents=True, exist_ok=True)
        self.procs: list[subprocess.Popen] = []
        self.logs: dict[str, Path] = {}
        self._log_handles: list = []

    def _log_handle(self, name: str):
        # Kept open for the child process's lifetime; closed in cleanup().
        handle = open(self.work / f"{name}.log", "wb")  # noqa: SIM115
        self._log_handles.append(handle)
        return handle

    def _spawn(self, name: str, cmd: list[str], env: dict) -> subprocess.Popen:
        log = self.work / f"{name}.log"
        out = self._log_handle(name)
        proc = subprocess.Popen(cmd, cwd=ROOT, env=env, stdout=out, stderr=subprocess.STDOUT)
        self.procs.append(proc)
        self.logs[name] = log
        return proc

    def _env(self, extra: dict) -> dict:
        env = dict(os.environ)
        env["PYTHONPATH"] = f"{ROOT}{os.pathsep}{ROOT / 'backend'}"
        env.update(extra)
        return env

    def start_servers(self) -> str:
        build_base_fixture(self.fixture_dir)
        self._spawn("fakes", [sys.executable, "-m", "rig.fakes.server"],
                    self._env({"HALO_FIXTURE_DIR": str(self.fixture_dir)}))
        _wait(lambda: _port_open(FAKES_PORT), 30, "fakes server")
        self._spawn("backend", [sys.executable, "-c", "from halo.app import main; main()"],
                    self._env({
                        "HALO_FAKES": "1",
                        "HALO_DATA_DIR": str(self.data_dir),
                        # LLMClient requires key presence even against
                        # the fake endpoint (see PR break list).
                        "BASETEN_API_KEY": "joined-dummy",
                        "META_API_KEY": "joined-dummy",
                    }))
        code = _wait(lambda: self._pairing_code(), 60, "backend pairing code")
        _wait(lambda: self._healthy(), 30, "backend health")
        return code

    def redeem(self, code: str) -> str:
        return _http_json(f"http://127.0.0.1:{BACKEND_PORT}/pair", {"code": code})["token"]

    def _pairing_code(self) -> str | None:
        log = self.logs.get("backend")
        if not log or not log.exists():
            return None
        m = re.search(r"pairing code: (\d{6})", log.read_text(errors="replace"))
        return m.group(1) if m else None

    def _healthy(self) -> bool:
        try:
            return _http_json(f"http://127.0.0.1:{BACKEND_PORT}/healthz").get("status") == "ok"
        except (OSError, ValueError):  # not up yet / not JSON yet
            return False

    def dump_debug(self) -> None:
        """On timeout: what reached the store, and what the servers said.

        API keys and the pairing code are masked before printing.
        """
        secrets = [v for k in ("BASETEN_API_KEY", "META_API_KEY")
                   if (v := os.environ.get(k))]
        try:
            code = self._pairing_code()
        except Exception:  # noqa: BLE001 -- debug dump must never mask the real failure
            code = None
        if code:
            secrets.append(code)

        def mask(text: str) -> str:
            text = re.sub(r"pairing code: \d{6}", "pairing code: <MASKED>", text)
            for secret in secrets:
                if secret:
                    text = text.replace(secret, "<MASKED>")
            return text

        try:
            counts: dict[str, int] = {}
            for event in read_events(self.data_dir):
                counts[event["type"]] = counts.get(event["type"], 0) + 1
            print(f"joined debug: events.sqlite type counts: {counts}")
        except Exception as exc:  # noqa: BLE001 -- debug dump must never mask the real failure
            print(f"joined debug: events.sqlite unreadable: {exc}")
        for name in ("backend", "fakes"):
            log = self.logs.get(name)
            if not log or not log.exists():
                print(f"joined debug: {name}.log missing")
                continue
            tail = log.read_text(errors="replace").splitlines()[-60:]
            print(f"joined debug: last {len(tail)} lines of {name}.log (masked):")
            for line in tail:
                print(f"  {name}: {mask(line)}")

    def build_extension(self) -> None:
        npm = shutil.which("npm") or "npm"
        ext = ROOT / "extension"
        if not (ext / "node_modules").exists():
            subprocess.run([npm, "install", "--loglevel=error"], cwd=ext, check=True)
        subprocess.run([npm, "run", "build"], cwd=ext, check=True)
        meet = ROOT / "rig" / "fake_meet"
        if not (meet / "node_modules").exists():
            subprocess.run([npm, "install", "--loglevel=error"], cwd=meet, check=True)
        # The joined spec drives a real Chromium; make the one-command run
        # self-contained by fetching it into a rig-local cache when absent.
        browsers = ROOT / ".pw-browsers"
        if not os.environ.get("PLAYWRIGHT_BROWSERS_PATH") and not browsers.exists():
            env = dict(os.environ, PLAYWRIGHT_BROWSERS_PATH=str(browsers))
            npx = shutil.which("npx") or "npx"
            subprocess.run([npx, "playwright", "install", "chromium"],
                           cwd=meet, env=env, check=True)

    def run(self, backend_only: bool = False) -> dict:
        code = self.start_servers()
        bubble: dict = {}
        if backend_only:
            transport = SyncTransport(self.redeem(code))
            meeting = str(uuid.uuid4())
            t0 = int(time.time() * 1000)
            build_fixture(self.fixture_dir, meeting, t0)
            fx = load_fixture(self.fixture_dir)
            started = {**fx.envelopes[0]}
            transport.send_envelope({k: v for k, v in started.items() if k != "ts_ms"})
            ModeA(fx, transport).run(fast=False, sleep_fn=lambda ms: time.sleep(ms / 1000))
            transport.close()
        else:
            bubble = self._run_browser(code)
            events = read_events(self.data_dir)
            hub_started = next(e for e in events if e["type"] == "meeting.started")
            meeting, t0 = hub_started["meetingid"], int(hub_started["data"]["t0_ms"])
            token_file = _wait(lambda: (self.signal_dir / "token.json").exists()
                               and json.loads((self.signal_dir / "token.json").read_text()),
                               30, "popup pairing token")
            build_fixture(self.fixture_dir, meeting, t0)
            fx = load_fixture(self.fixture_dir)
            transport = SyncTransport(token_file["token"])
            ModeA(fx, transport).run(fast=False, sleep_fn=lambda ms: time.sleep(ms / 1000))
            transport.close()
        _wait(lambda: len([e for e in read_events(self.data_dir)
                           if e["type"] == "points.upsert"]) >= len(POINTS),
              90, "points.upsert rows in events.sqlite")
        if not backend_only:
            (self.signal_dir / "replayed.flag").write_text("done")
            spec = self._spec_proc
            spec.wait(timeout=180)
            result_file = self.signal_dir / "result.json"
            bubble = json.loads(result_file.read_text()) if result_file.exists() else {}
            if spec.returncode != 0 or not bubble.get("ok"):
                tail = (self.work / "spec.log").read_text(errors="replace")[-3000:]
                raise RuntimeError(f"playwright joined spec failed (rc={spec.returncode}): {tail}")
        return self._verify(bubble)

    def _run_browser(self, code: str) -> dict:
        self.build_extension()
        # Fake Meet page server (the Playwright config would also start
        # one; reuseExistingServer makes the two agree on the port).
        log = self._log_handle("fake_meet")
        meet_proc = subprocess.Popen([shutil.which("node") or "node", "server.js"],
                                     cwd=ROOT / "rig" / "fake_meet",
                                     stdout=log, stderr=subprocess.STDOUT)
        self.procs.append(meet_proc)
        _wait(lambda: _port_open(MEET_PORT), 30, "fake meet server")
        env = dict(os.environ)
        local_browsers = ROOT / ".pw-browsers"
        if "PLAYWRIGHT_BROWSERS_PATH" not in env and local_browsers.exists():
            env["PLAYWRIGHT_BROWSERS_PATH"] = str(local_browsers)
        env.update({
            "HALO_JOINED": "1", "HALO_PAIR_CODE": code,
            "HALO_JOINED_DIR": str(self.signal_dir),
            "HALO_POINT_TEXT": POINTS[0]["response"]["text"],
            "HALO_SPEAKER_TILE": SPEAKER_TILE,
        })
        log = self._log_handle("spec")
        npx = shutil.which("npx") or "npx"
        self._spec_proc = subprocess.Popen(
            [npx, "playwright", "test", "tests/joined.spec.js", "--reporter=list"],
            cwd=ROOT / "rig" / "fake_meet", env=env, stdout=log, stderr=subprocess.STDOUT)
        self.procs.append(self._spec_proc)
        _wait(lambda: (self.signal_dir / "started.flag").exists(), 120, "Start in the page")
        _wait(lambda: [e for e in read_events(self.data_dir) if e["type"] == "meeting.started"],
              60, "hub meeting.started in events.sqlite")
        return {}

    def _verify(self, bubble: dict) -> dict:
        events = read_events(self.data_dir)
        fx_expected = [json.loads(l) for l in
                       (self.fixture_dir / "expected.jsonl").read_text().splitlines() if l.strip()]
        errors = check(fx_expected, events)
        by_turn: dict[str, dict] = {}
        for e in events:
            if e["type"] == "transcript.final":
                by_turn.setdefault(e["data"]["turn_id"], {})["final"] = e
            elif e["type"] == "points.upsert":
                for turn_id in e["data"].get("turn_ids", []):
                    by_turn.setdefault(turn_id, {})["point"] = e
        latencies = []
        for pair in by_turn.values():
            if "final" in pair and "point" in pair:
                start = _iso_ms(pair["final"]["time"])
                end = _iso_ms(pair["point"]["time"])
                latencies.append((end - start) / 1000.0)
        latency_p90 = p90(latencies) if latencies else float("inf")
        ok = not errors and len(latencies) == len(TURNS) and latency_p90 < 4.0
        if bubble:
            ok = ok and bool(bubble.get("ok"))
        return {
            "ok": ok, "checker_errors": errors, "latencies_s": latencies,
            "p90_pause_to_point_s": latency_p90, "bubble": bubble,
            "events": len(events), "workdir": str(self.work),
        }

    def cleanup(self) -> None:
        for proc in self.procs:
            if proc.poll() is None:
                if os.name == "nt":
                    # venv/node shims are trampolines: kill the whole tree
                    # or the real server keeps the port.
                    subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                                   check=False, capture_output=True)
                else:
                    proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()
        for handle in self._log_handles:
            handle.close()


def _port_open(port: int) -> bool:
    import socket

    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def _iso_ms(text: str) -> int:
    from datetime import datetime

    return int(datetime.fromisoformat(text).timestamp() * 1000)  # 3.12 parses "Z"


def run_all(backend_only: bool = False) -> dict:
    run = JoinedRun()
    try:
        return run.run(backend_only=backend_only)
    except (TimeoutError, subprocess.TimeoutExpired):
        run.dump_debug()
        raise
    finally:
        run.cleanup()


def main() -> int:
    backend_only = os.environ.get("JOINED_BACKEND_ONLY") == "1"
    print(f"joined run: {'backend-only smoke' if backend_only else 'full browser run'}")
    try:
        result = run_all(backend_only=backend_only)
    except Exception as exc:  # noqa: BLE001 -- CLI top level: any failure is the FAIL verdict
        print(f"JOINED FAIL: {exc}")
        return 1
    print(json.dumps(result, indent=1, ensure_ascii=False))
    print("JOINED PASS" if result["ok"] else "JOINED FAIL")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

