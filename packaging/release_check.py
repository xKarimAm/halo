"""Bounded boot release check: the shipped entry point really boots.

Spawns the backend the way a user starts it (`python -m halo.app`, the same
boot as the `halo` console script), waits for the pairing code on stdout,
then asserts `GET /pair` serves 200 on 127.0.0.1 and a foreign Host header
is rejected. Terminates the server afterwards. Run: `python
packaging/release_check.py` from the repo root. Exits nonzero on failure.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CODE_RE = re.compile(r"pairing code: (\d{6})")
BOOT_TIMEOUT = 60.0


def _get(path: str, host: str | None = None) -> int:
    req = urllib.request.Request(f"http://127.0.0.1:8765{path}")
    if host is not None:
        req.add_header("Host", host)
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return res.status
    except urllib.error.HTTPError as exc:
        return exc.code


def main() -> int:
    data_dir = Path(tempfile.mkdtemp(prefix="halo-release-check-"))
    env = dict(os.environ)
    env["HALO_FAKES"] = "1"  # no keys, no network: offline boot
    env["HALO_DATA_DIR"] = str(data_dir)
    # Boot the tree under test even when the venv points elsewhere.
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = os.pathsep.join(
        [str(ROOT), str(ROOT / "backend")] + ([existing] if existing else []))
    proc = subprocess.Popen(
        [sys.executable, "-m", "halo.app"], cwd=ROOT, env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    assert proc.stdout is not None
    lines: list[str] = []
    import threading
    import time

    def _drain() -> None:
        assert proc.stdout is not None
        lines.extend(proc.stdout)

    reader = threading.Thread(target=_drain, daemon=True)
    reader.start()
    try:
        code: str | None = None
        deadline = time.time() + BOOT_TIMEOUT
        while time.time() < deadline and proc.poll() is None and code is None:
            for line in lines:
                match = CODE_RE.search(line)
                if match:
                    code = match.group(1)
                    break
            time.sleep(0.2)
        if code is None:
            print("release-check FAIL: no pairing code on stdout; "
                  f"exit={proc.poll()}")
            for line in lines[-20:]:
                print("  child | " + line.rstrip())
            return 1
        print(f"release-check: backend booted, pairing code {code}")
        pair = _get("/pair")
        print(f"release-check: GET /pair -> {pair}")
        if pair != 200:
            print("release-check FAIL: expected 200 from GET /pair")
            return 1
        foreign = _get("/pair", host="evil.example")
        print(f"release-check: foreign Host -> {foreign}")
        if foreign != 400:
            print("release-check FAIL: expected 400 for a foreign Host")
            return 1
        print("release-check PASS")
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(data_dir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
