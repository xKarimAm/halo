"""Live insight: one model call per capped speaker turn batch, points upserted.

On each `turn.attributed`, at most 1 call / 3 s / speaker and at most 12 RPM
overall. Turns that hit a cap are held and coalesced into the next allowed
call for their speaker (all of them as new words, every held `turn_id` on the
point). Nothing bursts, nothing drops. `speaker.mapped.corrects[]` re-sends
stored points with the same `point_id` and no model call. Emits `llm.health`
on engine change, else at most every 30 s.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections import deque
from datetime import UTC, datetime
from typing import Any

log = logging.getLogger("halo.insight")

Envelope = dict[str, Any]

SPEAKER_WINDOW_S = 3.0
MAX_RPM = 12
RPM_WINDOW_S = 60.0
HEALTH_INTERVAL_S = 30.0
FLUSH_INTERVAL_S = 0.25
PROMPT_CACHE_KEY = "insight-v1"

POINT_RESULT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["point", "question", "decision", "pushback"]},
        "text": {"type": "string"},
        "quote": {"type": "string"},
        "rank": {"type": "integer", "minimum": 1, "maximum": 3},
        "urgency": {"type": "string", "enum": ["urgent", "medium", "later"]},
        "is_action": {"type": "boolean"},
        "replaces": {"type": "string", "format": "uuid"},
    },
    "required": ["kind", "text", "quote", "rank", "urgency", "is_action"],
    "additionalProperties": False,
}

INSTRUCTIONS = (
    "You turn meeting turns into live points for the viewer. "
    "Reply with ONE JSON object: the single most important NEW point from "
    "the new words below. kind is point|question|decision|pushback. "
    "quote must be the speaker's own words, verbatim. "
    "rank is 1-3 (1 = most important). urgency is urgent|medium|later. "
    "is_action is true when the point asks someone to do something. "
    "Set replaces only when this point supersedes an earlier point id."
)


class Insight:
    """Critical-path live points. The model client is injected (duck-typed)."""

    def __init__(
        self,
        bus: Any,
        llm: Any,
        *,
        clock: Any = None,
        speaker_window_s: float = SPEAKER_WINDOW_S,
        max_rpm: int = MAX_RPM,
        health_interval_s: float = HEALTH_INTERVAL_S,
        flush_interval_s: float = FLUSH_INTERVAL_S,
    ) -> None:
        self._bus = bus
        self._llm = llm
        self._clock = clock or time.monotonic
        self._speaker_window = speaker_window_s
        self._max_rpm = max_rpm
        self._health_interval = health_interval_s
        self._flush_interval = flush_interval_s
        self._held: dict[tuple[str, str], list[dict[str, Any]]] = {}
        self._last_call: dict[tuple[str, str], float] = {}
        self._call_times: deque[float] = deque()
        self._contexts: dict[str, dict[str, Any]] = {}
        self._points: dict[str, dict[str, dict[str, Any]]] = {}
        self._turn_points: dict[tuple[str, str], list[str]] = {}
        self._latencies: list[float] = []
        self._last_health_engine: str | None = None
        self._last_health_at = 0.0
        self._task: asyncio.Task | None = None
        bus.subscribe("turn.attributed", self._on_turn)
        bus.subscribe("speaker.mapped", self._on_mapped)
        bus.subscribe("meeting.context", self._on_context)

    def health(self) -> dict[str, Any]:
        """System-status shape; delegates to the injected model client."""
        try:
            current = self._llm.health()
        except Exception:
            log.exception("llm health callable failed")
            current = None
        if isinstance(current, dict) and isinstance(current.get("engine"), str):
            return {"engine": current["engine"], "failover": bool(current.get("failover"))}
        return {"engine": "unknown", "failover": False}

    def start(self) -> None:
        self._task = asyncio.get_running_loop().create_task(self._flush_loop())

    def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            self._task = None

    async def _flush_loop(self) -> None:
        while True:
            await asyncio.sleep(self._flush_interval)
            await self.flush()

    # -- inputs -----------------------------------------------------------

    async def _on_turn(self, envelope: Envelope) -> None:
        data = envelope.get("data")
        meetingid = envelope.get("meetingid")
        if not isinstance(data, dict) or not isinstance(meetingid, str):
            return
        key = (meetingid, str(data.get("name", "")))
        self._held.setdefault(key, []).append(data)
        await self.flush()

    async def _on_context(self, envelope: Envelope) -> None:
        data = envelope.get("data")
        meetingid = envelope.get("meetingid")
        if isinstance(data, dict) and isinstance(meetingid, str):
            self._contexts[meetingid] = data

    async def _on_mapped(self, envelope: Envelope) -> None:
        data = envelope.get("data")
        meetingid = envelope.get("meetingid")
        if not isinstance(data, dict) or not isinstance(meetingid, str):
            return
        corrects = data.get("corrects") or []
        if not isinstance(corrects, list):
            return
        for turn_id in corrects:
            for point_id in self._turn_points.get((meetingid, str(turn_id)), []):
                stored = self._points.get(meetingid, {}).get(point_id)
                if stored is None:
                    continue
                fixed = {
                    **stored,
                    "tile_id": data.get("tile_id", stored["tile_id"]),
                    "speaker_name": data.get("name", stored["speaker_name"]),
                    "attribution": "locked",
                }
                self._points[meetingid][point_id] = fixed
                await self._bus.publish(self._envelope("points.upsert", fixed, meetingid))

    # -- flushing ----------------------------------------------------------

    async def flush(self) -> None:
        pending = [(min(t.get("ts_start_ms", 0) for t in turns), key)
                   for key, turns in self._held.items() if turns]
        for _, key in sorted(pending):
            if self._flushable(key, self._clock()):
                await self._flush_speaker(key)

    def _flushable(self, key: tuple[str, str], now: float) -> bool:
        if now - self._last_call.get(key, float("-inf")) < self._speaker_window:
            return False
        while self._call_times and self._call_times[0] <= now - RPM_WINDOW_S:
            self._call_times.popleft()
        return len(self._call_times) < self._max_rpm

    async def _flush_speaker(self, key: tuple[str, str]) -> None:
        meetingid, _ = key
        turns = self._held.pop(key, [])
        if not turns:
            return
        now = self._clock()
        context = self._contexts.get(meetingid, {})
        viewer_lang = context.get("viewer_lang", "en")
        prompt = self.build_prompt(context, meetingid, str(turns[0].get("name", "")), turns)
        start = self._clock()
        result = await asyncio.to_thread(
            self._llm.complete_json,
            prompt=prompt,
            schema=POINT_RESULT_SCHEMA,
            schema_name="insight.point",
            prompt_cache_key=PROMPT_CACHE_KEY,
        )
        elapsed = self._clock() - start
        if not result.ok or not isinstance(result.data, dict):
            log.warning("insight call failed, %d turns re-queued", len(turns))
            self._held[key] = turns + self._held.get(key, [])
            self._last_call[key] = now
            return
        self._last_call[key] = now
        self._call_times.append(now)
        self._latencies.append(elapsed)
        del self._latencies[:-100]
        latest = turns[-1]
        point: dict[str, Any] = {
            "point_id": str(uuid.uuid4()),
            "tile_id": latest.get("tile_id", ""),
            "speaker_name": latest.get("name", ""),
            "kind": result.data["kind"],
            "text": result.data["text"],
            "lang": viewer_lang,
            "quote": result.data["quote"],
            "turn_ids": [t["turn_id"] for t in turns],
            "rank": result.data["rank"],
            "attribution": latest.get("attribution", "provisional"),
            "urgency": result.data["urgency"],
            "is_action": result.data["is_action"],
            "engine": result.engine,
        }
        if result.data.get("replaces"):
            point["replaces"] = result.data["replaces"]
        self._points.setdefault(meetingid, {})[point["point_id"]] = point
        for turn in turns:
            self._turn_points.setdefault((meetingid, turn["turn_id"]), []).append(point["point_id"])
        await self._bus.publish(self._envelope("points.upsert", point, meetingid))
        await self._maybe_emit_health(result.engine)

    # -- prompt + health ----------------------------------------------------

    def build_prompt(
        self,
        context: dict[str, Any],
        meetingid: str,
        speaker: str,
        turns: list[dict[str, Any]],
    ) -> str:
        viewer_lang = context.get("viewer_lang", "en")
        lines = [INSTRUCTIONS]
        subject = context.get("subject")
        lines.append(f"Meeting: {subject or 'unspecified'} | Viewer language: {viewer_lang}")
        if context.get("agenda"):
            lines.append("Agenda: " + "; ".join(str(a) for a in context["agenda"]))
        roles = context.get("roles") or []
        if roles:
            lines.append("Roles: " + ", ".join(
                f"{r.get('name')} ({r.get('role')})" if r.get("role") else str(r.get("name"))
                for r in roles if isinstance(r, dict)))
        current = [p for p in self._points.get(meetingid, {}).values()
                   if p.get("speaker_name") == speaker]
        if current:
            lines.append(f"{speaker}'s points so far:")
            lines.extend(f"- [{p['kind']}] {p['text']}" for p in current)
        lines.append(f"New words from {speaker}:")
        lines.extend(f"- {t.get('text', '')}" for t in turns)
        return "\n".join(lines)

    async def _maybe_emit_health(self, engine: str) -> None:
        now = self._clock()
        if engine != self._last_health_engine or now - self._last_health_at >= self._health_interval:
            self._last_health_engine = engine
            self._last_health_at = now
            latencies = sorted(self._latencies)
            p90_ms = int(latencies[int(0.9 * (len(latencies) - 1))] * 1000) if latencies else 0
            await self._bus.publish(self._envelope(
                "llm.health", {"engine": engine, "p90_ms": p90_ms}, None))

    def _envelope(self, type_: str, data: dict[str, Any], meetingid: str | None) -> Envelope:
        return {
            "specversion": "1.0",
            "id": str(uuid.uuid4()),
            "type": type_,
            "source": "halo/insight",
            "time": datetime.now(UTC).isoformat(),
            "meetingid": meetingid,
            "datacontenttype": "application/json",
            "data": data,
        }
