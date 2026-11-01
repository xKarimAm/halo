"""Ops files for agents: alerts dedupe per template, health problems, log config."""

from __future__ import annotations

import json
import logging
import logging.config

from halo.monitor import AlertHandler, check, log_config


def _record(msg: str, *args: object) -> logging.LogRecord:
    return logging.LogRecord("halo.gateway.audio", logging.WARNING, __file__, 1, msg, args, None)


def test_alert_flood_is_one_line_per_template_per_window(tmp_path):
    handler = AlertHandler(str(tmp_path / "alerts.jsonl"), window_s=60)
    for seq in range(500):  # tonight: 81k of these
        handler.emit(_record("audio queue full, frame dropped (stream=%s seq=%s)", 1, seq))
    handler.emit(_record("transcriber session reconnecting: stream=%s", "tab"))
    lines = [json.loads(x) for x in (tmp_path / "alerts.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [x["message"] for x in lines] == [
        "audio queue full, frame dropped (stream=1 seq=0)", "transcriber session reconnecting: stream=tab"]
    handler.window_s = 0  # window over: the next line counts what was suppressed
    handler.emit(_record("audio queue full, frame dropped (stream=%s seq=%s)", 1, 500))
    last = json.loads((tmp_path / "alerts.jsonl").read_text(encoding="utf-8").splitlines()[-1])
    assert last["suppressed_before"] == 499 and last["level"] == "WARNING"


def test_check_flags_what_no_module_logs():
    gateway = {"sessions": 5, "sockets_opened": 9, "audio_age_s": {"tab": 2.0, "mic": 45.0}}
    snap = {
        "queues": {"tab": [10, 200], "mic": [190, 200], "rec": [0, 200]},
        "modules": {"gateway": gateway, "asr": "reconnecting", "tagger": "ok",
                    "llm": {"engine": "spark", "failover": True}},
    }
    assert set(check(snap, opens_minute_ago=2)) == {
        "sockets", "churn", "audio.mic", "queue.mic", "module.asr", "module.llm"}
    gateway.update(sessions=1, audio_age_s={"tab": 0.1, "mic": 0.1})
    snap["queues"]["mic"] = [0, 200]
    snap["modules"].update(asr="ok", llm={"engine": "spark", "failover": False})
    assert check(snap, opens_minute_ago=9) == {}


def test_log_config_writes_backend_log_and_alerts(tmp_path):
    logging.config.dictConfig(log_config(tmp_path))
    try:
        logging.getLogger("halo.transcriber").info("turn final")
        logging.getLogger("halo.transcriber").warning("voice closed 1008")
        logging.getLogger("uvicorn.error").error("boom")
    finally:
        logging.config.dictConfig({"version": 1, "disable_existing_loggers": False,
                                   "root": {"handlers": [], "level": "WARNING"}})
    text = (tmp_path / "backend.log").read_text(encoding="utf-8")
    assert "turn final" in text and "voice closed 1008" in text and "boom" in text
    alerts = (tmp_path / "alerts.jsonl").read_text(encoding="utf-8")
    assert "voice closed 1008" in alerts and "boom" in alerts and "turn final" not in alerts


def test_mic_pure_silence_is_a_problem_within_10_s():
    # Live 2026-11-01: every mic sample was 0 while Karim talked; nothing said so for 60 s.
    gateway = {"sessions": 1, "sockets_opened": 1, "audio_age_s": {"tab": 0.1, "mic": 0.1}}
    mic = {"frames": 120, "level_rms": 0, "silent_s": 12.0}
    snap = {"queues": {}, "modules": {"gateway": gateway}, "streams": {"mic": mic}}
    assert set(check(snap, opens_minute_ago=1)) == {"mic.zero"}
    mic["level_rms"] = 40  # faint room noise: a live mic, user just quiet
    assert check(snap, opens_minute_ago=1) == {}
