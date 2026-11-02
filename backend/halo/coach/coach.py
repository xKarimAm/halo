"""Meeting coach (plan step 3b, Karim 2026-11-02): live steering for the viewer.

Reacts within seconds instead of once a minute: new words (at most one call
per MIN_GAP_S) or a silence of SILENCE_S each trigger one model call over the
meeting so far (newest MAX_WORDS kept). The reply is 0-3 tips plus an
optional alert, a short command for a moment that needs action now ("Remove
the personal remark."). Tips speak to the viewer as "you" and coach the way a
strong coach for the viewer's Setup role would. Published as `coach.tips`;
each event replaces the last on the Overlay. Own loop, its own calls, never
awaited from a bus handler, so the Insight lane never waits on it.

Coaching rules come from facilitation and conflict research (Karim asked,
2026-11-02): work disagreement is healthy, personal disagreement is not, and
the risk is the first turning into the second; silence after a question is
thinking time before it is a problem.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import UTC, datetime
from typing import Any

log = logging.getLogger("halo.coach")

TICK_S = 1.0
MIN_GAP_S = 8.0  # ponytail: one call per 8 s per meeting at most (~7 RPM); raise if RPM gets tight
SILENCE_S = 15.0  # one silence call per quiet stretch
MAX_WORDS = 2000  # newest words only; shorter input, faster call
PROMPT_CACHE_KEY = "coach-v2"

TIPS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "tips": {"type": "array", "items": {"type": "string", "minLength": 1, "maxLength": 160},
                 "maxItems": 3},
        "alert": {"type": "string", "maxLength": 80},
    },
    "required": ["tips", "alert"],
    "additionalProperties": False,
}

INSTRUCTIONS = (
    "You are a live meeting coach whispering to one person, the viewer. Talk "
    "to them as you. Coach the way an experienced coach for their role would: "
    "bring what a strong person in that role watches for (for a product "
    "manager: users, metrics, revenue, scope; for sales: needs, objections, "
    "next step). Reply with one JSON object.\n"
    "alert: one short command (at most 6 words, ending with a period) only "
    "when the viewer must act now, else empty. Use it when a disagreement "
    "turns personal or heated (Remove the personal remark. / De-escalate "
    "now: pause first. / Lower your tone.), when the same people repeat "
    "themselves with no new facts (Park it: owner and date.), or when the "
    "viewer talks over others or too long (Let them finish.).\n"
    "tips: 0 to 3 tips, each one sentence of at most 16 words ending with a "
    "period, naming a person or topic. Disagreement about the work is "
    "healthy: keep it on the work (ask each side to restate the other's view, "
    "ask what would change their mind, split facts from opinions, name who "
    "decides). Silence: after a question, wait a few seconds, then rephrase "
    "it or ask someone by name; after a decision, confirm owner and date; "
    "after tension, summarise both sides. Also: a decision with no owner or "
    "date, a question nobody answered, someone who has not spoken, a topic "
    "running long against the agenda.\n"
    "Return empty tips when the previous tips still fit and nothing new needs "
    "the viewer; never repeat a previous tip. Write in the viewer language."
)


class Coach:
    def __init__(self, bus: Any, llm: Any, *, clock: Any = None, min_gap_s: float = MIN_GAP_S,
                 silence_s: float = SILENCE_S, max_words: int = MAX_WORDS) -> None:
        self._bus = bus
        self._llm = llm
        self._clock = clock or time.monotonic
        self._min_gap = min_gap_s
        self._silence = silence_s
        self._max_words = max_words
        self._turns: dict[str, list[tuple[str, str]]] = {}
        self._contexts: dict[str, dict[str, Any]] = {}
        self._self_names: dict[str, str] = {}
        self._tips: dict[str, list[str]] = {}
        self._due: set[str] = set()  # new words since the last call
        self._last_turn: dict[str, float] = {}
        self._last_call: dict[str, float] = {}
        self._silence_spent: set[str] = set()
        self._task: asyncio.Task | None = None
        bus.subscribe("turn.attributed", self._on_turn)
        bus.subscribe("meeting.started", self._on_started)
        bus.subscribe("meeting.context", self._on_context)
        bus.subscribe("meeting.ended", self._on_ended)

    def start(self) -> None:
        self._task = asyncio.get_running_loop().create_task(self._loop())

    def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            self._task = None

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(TICK_S)
            try:
                await self.tick()
            except Exception:
                log.exception("coach tick failed")

    async def _on_turn(self, envelope: dict[str, Any]) -> None:
        data, meetingid = envelope.get("data"), envelope.get("meetingid")
        if not isinstance(data, dict) or not isinstance(meetingid, str):
            return
        text = str(data.get("text", "")).strip()
        if text:
            self._turns.setdefault(meetingid, []).append((str(data.get("name") or "?"), text))
            self._due.add(meetingid)
            self._last_turn[meetingid] = self._clock()
            self._silence_spent.discard(meetingid)

    async def _on_started(self, envelope: dict[str, Any]) -> None:
        data, meetingid = envelope.get("data"), envelope.get("meetingid")
        if isinstance(data, dict) and isinstance(meetingid, str) and data.get("self_name"):
            self._self_names[meetingid] = str(data["self_name"])

    async def _on_context(self, envelope: dict[str, Any]) -> None:
        data, meetingid = envelope.get("data"), envelope.get("meetingid")
        if isinstance(data, dict) and isinstance(meetingid, str):
            self._contexts[meetingid] = data

    async def _on_ended(self, envelope: dict[str, Any]) -> None:
        meetingid = envelope.get("meetingid")
        for store in (self._turns, self._contexts, self._self_names, self._tips,
                      self._last_turn, self._last_call):
            store.pop(meetingid, None)
        self._due.discard(meetingid)
        self._silence_spent.discard(meetingid)

    def _reason(self, meetingid: str, now: float) -> str | None:
        """Why to call now, or None. New words win over silence."""
        if meetingid in self._due and now - self._last_call.get(meetingid, -1e9) >= self._min_gap:
            return "new words"
        quiet = now - self._last_turn.get(meetingid, now)
        if meetingid not in self._silence_spent and quiet >= self._silence:
            self._silence_spent.add(meetingid)
            return f"{quiet:.0f} s of silence since the last words"
        return None

    async def tick(self) -> None:
        """One call per meeting that has a reason (the loop runs it every second).
        ponytail: meetings are called one after another; one meeting is live at a time."""
        now = self._clock()
        for meetingid in list(self._turns):
            reason = self._reason(meetingid, now)
            if reason is None:
                continue
            self._due.discard(meetingid)
            self._last_call[meetingid] = now
            result = await asyncio.to_thread(
                self._llm.complete_json, prompt=self.build_prompt(meetingid, reason),
                schema=TIPS_SCHEMA, schema_name="coach.tips", prompt_cache_key=PROMPT_CACHE_KEY)
            if meetingid not in self._turns:
                continue  # the meeting ended during the call
            if result is None or not result.ok or not isinstance(result.data, dict):
                log.warning("coach call failed; the next tick tries again")
                self._due.add(meetingid)
                continue
            await self._publish(meetingid, result.data)

    async def _publish(self, meetingid: str, data: dict[str, Any]) -> None:
        tips = [str(t).strip()[:160] for t in data.get("tips", []) if str(t).strip()][:3]
        alert = str(data.get("alert") or "").strip()[:80]
        if not tips and not alert:
            return  # nothing new for the viewer: the panel keeps its tips
        tips = tips or self._tips.get(meetingid, [])
        self._tips[meetingid] = tips
        lang = self._contexts.get(meetingid, {}).get("viewer_lang", "en")
        payload: dict[str, Any] = {"tips": tips, "lang": lang if lang in ("en", "ar") else "en"}
        if alert:
            payload["alert"] = alert
        await self._bus.publish({
            "specversion": "1.0", "id": str(uuid.uuid4()), "type": "coach.tips",
            "source": "halo/coach", "time": datetime.now(UTC).isoformat(),
            "meetingid": meetingid, "datacontenttype": "application/json", "data": payload,
        })

    def build_prompt(self, meetingid: str, reason: str = "new words") -> str:
        context = self._contexts.get(meetingid, {})
        me = self._self_names.get(meetingid, "")
        roles = [r for r in context.get("roles") or [] if isinstance(r, dict)]
        my_role = next((r.get("role") for r in roles if me and r.get("name") == me and r.get("role")), "")
        lines = [INSTRUCTIONS,
                 f"Viewer: {me or 'unknown'}" + (f", {my_role}" if my_role else ""),
                 (f"Meeting: {context.get('subject') or 'unspecified'} | "
                  f"Viewer language: {context.get('viewer_lang', 'en')}")]
        if context.get("agenda"):
            lines.append("Agenda: " + "; ".join(str(a) for a in context["agenda"]))
        if roles:
            lines.append("Roles: " + ", ".join(
                f"{r.get('name')} ({r.get('role')})" if r.get("role") else str(r.get("name"))
                for r in roles))
        if self._tips.get(meetingid):
            lines.append("Previous tips: " + " ".join(self._tips[meetingid]))
        lines.append(f"Why now: {reason}")
        lines.append("The meeting so far:")
        kept: list[str] = []
        budget = self._max_words
        for name, text in reversed(self._turns.get(meetingid, [])):
            budget -= len(text.split())
            if budget < 0:
                break
            kept.append(f"{name}{' (you)' if me and name == me else ''}: {text}")
        lines.extend(reversed(kept))
        return "\n".join(lines)
