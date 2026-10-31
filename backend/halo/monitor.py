"""Ops files any agent can read without the console or port 8765.

Live 2026-10-31: the zero-transcripts cause sat an hour in a console nobody
could read. Now, under the data dir:

- backend.log: every log line at INFO and up (rotating, 4 x 10 MB).
- alerts.jsonl: one JSON line per WARNING+ record. The same message template
  writes at most once a minute; the next line counts what was suppressed.
- health.json: rewritten every 5 s (module health, sockets, queues, audio age).
  The loop also raises the alerts that no module logs on its own.
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import os
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import uvicorn.config

log = logging.getLogger("halo.monitor")

ALERT_WINDOW_S = 60.0
HEALTH_EVERY_S = 5.0
AUDIO_STALE_S = 30.0  # a stream that had frames and stopped while a socket is open
QUEUE_HIGH = 0.75  # share of a bounded queue that counts as a backlog
CHURN_OPENS = 3  # socket opens within one minute that count as churn


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class AlertHandler(logging.Handler):
    def __init__(self, path: str, window_s: float = ALERT_WINDOW_S) -> None:
        super().__init__(logging.WARNING)
        self.path = Path(path)
        self.window_s = window_s
        self._last: dict[tuple[str, str], tuple[float, int]] = {}

    def emit(self, record: logging.LogRecord) -> None:
        key = (record.name, str(record.msg))
        now = time.monotonic()
        last, suppressed = self._last.get(key, (-self.window_s, 0))
        if now - last < self.window_s:
            self._last[key] = (last, suppressed + 1)
            return
        self._last[key] = (now, 0)
        line: dict[str, Any] = {"time": _now(), "level": record.levelname, "source": record.name,
                                "message": record.getMessage(), "suppressed_before": suppressed}
        if record.exc_info and record.exc_info[1] is not None:
            line["error"] = repr(record.exc_info[1])
        try:
            with self.path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(line, ensure_ascii=False) + "\n")
        except OSError:
            self.handleError(record)


def log_config(data_dir: Path) -> dict[str, Any]:
    """uvicorn's own config plus the log file, the alerts file and a root logger."""
    cfg = copy.deepcopy(uvicorn.config.LOGGING_CONFIG)
    cfg["formatters"]["file"] = {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"}
    cfg["handlers"]["file"] = {
        "class": "logging.handlers.RotatingFileHandler", "formatter": "file",
        "filename": str(data_dir / "backend.log"), "maxBytes": 10_000_000, "backupCount": 3,
        "encoding": "utf-8",
    }
    cfg["handlers"]["alerts"] = {"()": AlertHandler, "path": str(data_dir / "alerts.jsonl")}
    cfg["handlers"]["console"] = {"class": "logging.StreamHandler", "formatter": "file",
                                  "level": "WARNING"}
    cfg["root"] = {"level": "INFO", "handlers": ["console", "file", "alerts"]}
    cfg["loggers"]["uvicorn"]["handlers"] += ["file", "alerts"]
    cfg["loggers"]["uvicorn.access"]["handlers"] += ["file"]
    return cfg


def snapshot(app: Any) -> dict[str, Any]:
    state = app.state
    queues = {"tab": state.audio_tab_queue, "mic": state.audio_mic_queue, "rec": state.rec_queue}
    return {
        "time": _now(),
        "modules": state.bus.health(),  # includes the gateway's sockets and audio age
        "queues": {name: [q.qsize(), q.maxsize] for name, q in queues.items()},
    }


def check(snap: dict[str, Any], opens_minute_ago: int) -> dict[str, str]:
    """Problems no module logs by itself, by stable key; each becomes an alert."""
    problems = {}
    gw = snap["modules"]["gateway"]
    if gw["sessions"] > 1:
        problems["sockets"] = f"{gw['sessions']} extension sockets open at once (repeat Start?)"
    if gw["sockets_opened"] - opens_minute_ago >= CHURN_OPENS:
        problems["churn"] = f"{gw['sockets_opened'] - opens_minute_ago} socket opens in the last minute"
    for stream, age in gw["audio_age_s"].items():
        if gw["sessions"] and age is not None and age > AUDIO_STALE_S:
            problems[f"audio.{stream}"] = f"no {stream} audio for {age:.0f} s while the extension is connected"
    for name, (size, maxsize) in snap["queues"].items():
        if maxsize and size >= QUEUE_HIGH * maxsize:
            problems[f"queue.{name}"] = f"{name} queue backlog {size}/{maxsize}"
    for name, value in snap["modules"].items():
        if isinstance(value, dict):  # llm/insight: {"engine", "failover"}; gateway: counters
            value = "failover" if value.get("failover") else "ok"
        if value in ("down", "reconnecting", "degraded", "failover"):
            problems[f"module.{name}"] = f"{name} is {value}"
    return problems


async def health_loop(app: Any, data_dir: Path, every_s: float = HEALTH_EVERY_S) -> None:
    path = data_dir / "health.json"
    opens: list[int] = []  # sockets_opened per tick, last minute
    while True:
        try:
            snap = snapshot(app)
            opens = (opens + [snap["modules"]["gateway"]["sockets_opened"]])[-int(60 / every_s):]
            snap["problems"] = check(snap, opens[0])
            for key, text in snap["problems"].items():
                log.warning(f"health {key}: %s", text)  # key in the template: deduped per problem
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(snap, ensure_ascii=False, indent=1), encoding="utf-8")
            os.replace(tmp, path)
        except Exception:
            log.exception("health snapshot failed")
        await asyncio.sleep(every_s)
