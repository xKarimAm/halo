"""Coach eval: replay scripted meetings through the real coach prompt and model.

    uv run python backend/halo/coach/eval/run_eval.py OUT.jsonl [COACH_PY] [ROUNDS]

COACH_PY defaults to the coach module in this checkout; pass another copy to
compare prompt versions. Each checkpoint builds the prompt exactly as the live
coach does (previous published tips carried forward) and goes through the
coach's own _publish filter, so what is saved is what the viewer would see.
Needs the Meta API key in .env (a real model call per checkpoint).
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "backend"))
from halo.app import load_dotenv
from halo.llm import LLMClient

HERE = Path(__file__).resolve().parent
MID = "eval"


class Bus:
    def __init__(self) -> None:
        self.out: list[dict] = []

    def subscribe(self, *_a) -> None:
        pass

    async def publish(self, envelope: dict) -> None:
        self.out.append(envelope["data"])


def load_coach(path: Path):
    spec = importlib.util.spec_from_file_location(f"coach_{abs(hash(str(path)))}", path)
    assert spec is not None and spec.loader is not None, path
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run_scenario(mod, llm: LLMClient, sc: dict, rnd: int) -> list[dict]:
    bus = Bus()
    coach = mod.Coach(bus, None)
    coach._self_names[MID] = sc["self_name"]
    coach._contexts[MID] = sc["context"]
    coach._people[MID] = list(sc["people"])
    rows = []
    for i, cp in enumerate(sc["checkpoints"]):
        coach._turns[MID] = [tuple(t) for t in sc["turns"][: cp["after_turn"]]]
        prompt = coach.build_prompt(MID, cp["why_now"])
        t0 = time.time()
        res = llm.complete_json(prompt=prompt, schema=mod.TIPS_SCHEMA, schema_name="coach.tips",
                                prompt_cache_key=mod.PROMPT_CACHE_KEY)
        secs = round(time.time() - t0, 1)
        before = len(bus.out)
        if res.ok and isinstance(res.data, dict):
            asyncio.run(coach._publish(MID, res.data))
        shown = bus.out[-1] if len(bus.out) > before else None
        rows.append({"scenario": sc["id"], "checkpoint": i, "round": rnd, "after_turn": cp["after_turn"],
                     "why_now": cp["why_now"], "secs": secs, "ok": res.ok,
                     "raw": res.data if res.ok else None, "shown": shown})
    return rows


def main() -> None:
    out = Path(sys.argv[1])
    coach_py = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "backend/halo/coach/coach.py"
    rounds = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    load_dotenv()
    mod = load_coach(coach_py)
    llm = LLMClient()
    scenarios = json.loads((HERE / "scenarios.json").read_text(encoding="utf-8"))
    jobs = [(sc, r) for r in range(rounds) for sc in scenarios]
    with ThreadPoolExecutor(5) as pool:  # ponytail: 5 parallel calls stays far under the 150 RPM cap
        results = list(pool.map(lambda j: run_scenario(mod, llm, *j), jobs))
    rows = [row for rs in results for row in rs]
    out.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
    secs = sorted(r["secs"] for r in rows)
    fails = sum(not r["ok"] for r in rows)
    print(f"{len(rows)} checkpoints, median {secs[len(secs) // 2]} s, max {secs[-1]} s, failed {fails}")


if __name__ == "__main__":
    main()
