"""Demo meetings without a call: three scripted meetings through the real pipeline.

    uv run python packaging/demo.py

Each scripted turn goes on the bus exactly as the Correlator would publish it
(`turn.attributed`), so Insight, the Classifier, the Coach and the Notes Builder
run on the real Meta models; only the microphone, Meet and speech-to-text are
skipped. The meetings land in the normal data folder, so `uv run halo` then
shows them on the notes page. Needs META_API_KEY in .env (about 3 minutes,
roughly 40 model calls). Safe to run while `uv run halo` is running.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT)]
os.chdir(ROOT)  # the data folder and .env resolve from the repo root
sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]  # Arabic on Windows

from halo.app import create_app, load_dotenv

TURN_GAP_S = 2.5  # live-like pacing: Insight batches by pause, the coach by new words
NOTES_TIMEOUT_S = 90

SCENARIOS = {s["id"]: s for s in json.loads(
    (ROOT / "backend/halo/coach/eval/scenarios.json").read_text(encoding="utf-8"))}

MIXED = {
    "id": "mixed-launch", "self_name": "Karim", "people": ["Karim", "Layla", "Omar"],
    "context": {"subject": "Launch sync", "agenda": ["launch date", "pricing"],
                "roles": [{"name": "Karim", "role": "Technical product manager"}], "viewer_lang": "en"},
    "turns": [["Karim", "OK let's start, we need to lock the launch date today."],
              ["Layla", "أنا أشوف إن الإطلاق يكون في خمسة عشر يناير، the QA team needs two more weeks."],
              ["Omar", "Honestly I disagree, ديسمبر أفضل لأن الحملة التسويقية جاهزة."],
              ["Karim", "What does the data say about December signups?"],
              ["Layla", "ما عندنا بيانات واضحة، it's mostly a guess from last year."],
              ["Omar", "طيب، I can pull the numbers by Thursday."],
              ["Karim", ("Great, Omar owns the signup numbers by Thursday. "
                         "Layla, can you confirm the QA plan by Monday?")],
              ["Layla", "تمام، by Monday."],
              ["Karim", "And pricing, نبقي الباقة المجانية ثلاثة اجتماعات في الشهر؟"],
              ["Omar", "Yes, three meetings free, and we decide the Pro price next week."]],
}
DEMO = [SCENARIOS["tpm-product-review-no-metrics"], SCENARIOS["arabic-deadline-dispute"], MIXED]


def envelope(etype: str, mid: str, data: dict) -> dict:
    return {"specversion": "1.0", "id": str(uuid.uuid4()), "type": etype, "source": "halo/demo",
            "time": datetime.now(UTC).isoformat(), "meetingid": mid,
            "datacontenttype": "application/json", "data": data}


def tile(i: int, name: str, me: str) -> dict:
    return {"tile_id": f"t{i}", "name": name, "is_self": name == me, "rect": [0, 0, 10, 10],
            "video_w": 640, "video_h": 360, "fit": "cover", "captions_rect": None}


def lang_of(text: str) -> str:
    ar = any("؀" <= c <= "ۿ" for c in text)
    en = any(c.isascii() and c.isalpha() for c in text)
    return "mixed" if ar and en else "ar" if ar else "en"


async def play(bus, sc: dict, notes: dict) -> str:
    mid = str(uuid.uuid4())
    names = sc["people"]

    async def pub(etype: str, data: dict) -> None:
        await bus.publish(envelope(etype, mid, data))

    await pub("meeting.started", {"meeting_id": mid, "platform": "meet", "meeting_code": "abc-defg-hij",
                                  "t0_ms": int(time.time() * 1000), "self_name": sc["self_name"]})
    await pub("meeting.context", sc["context"])
    await pub("tiles.snapshot", {"tiles": [tile(i, n, sc["self_name"]) for i, n in enumerate(names)]})
    for name, text in sc["turns"]:
        now = int(time.time() * 1000)
        dur = max(1500, len(text.split()) * 350)  # ~170 words a minute
        await pub("turn.attributed", {"turn_id": str(uuid.uuid4()), "text": text, "lang": lang_of(text),
                                      "ts_start_ms": now - dur, "ts_end_ms": now,
                                      "tile_id": f"t{names.index(name)}", "name": name,
                                      "attribution": "locked", "overlap": False})
        await asyncio.sleep(TURN_GAP_S)
    await asyncio.sleep(10)  # let the last points and tags land before the notes
    await pub("meeting.ended", {"reason": "left"})
    deadline = time.time() + NOTES_TIMEOUT_S
    while time.time() < deadline and mid not in notes:
        await asyncio.sleep(1)
    return mid


async def main() -> int:
    load_dotenv()
    logging.getLogger("halo").setLevel(logging.ERROR)  # health chatter stays in the log files
    if not os.environ.get("META_API_KEY"):
        print("META_API_KEY is empty in .env. Add your Meta Model API key, then run this again.")
        return 1
    app = create_app()
    bus = app.state.bus
    notes: dict[str, dict] = {}

    async def on_notes(env: dict) -> None:
        notes[env["meetingid"]] = env["data"]

    bus.subscribe("notes.ready", on_notes)
    async with app.router.lifespan_context(app):
        for sc in DEMO:
            print(f"Playing \"{sc['context'].get('subject') or sc['id']}\" ({len(sc['turns'])} turns)...", flush=True)
            mid = await play(bus, sc, notes)
            ready = notes.get(mid)
            if ready is None:
                print("  notes not ready in time; the notes page shows the live points.")
            else:
                print(f"  {ready.get('title') or 'Notes ready'}" + ("  (fallback notes)" if ready.get("degraded") else ""))
            print(f"  http://127.0.0.1:8765/notes/{mid}", flush=True)
        spend = app.state.llm.usage()  # Karim 2026-11-04: what the run cost
    calls = sum(v["calls"] for k, v in spend.items() if k != "usd_total")
    print(f"Model calls: {calls}, estimated ${spend['usd_total']:.3f} at list price.")
    print("Done. Start the backend (uv run halo) if it is not running, then open the links above.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
