"""Meeting coach (plan step 3b, Karim 2026-11-02): the slow lane.

About every 60 s, when at least MIN_NEW_WORDS were said since the last call,
one model call reads the whole meeting so far (capped at MAX_WORDS, newest
kept) and returns 1-3 short tips on how to steer it: who has not spoken, what
has no owner or date, what was left open. Published as `coach.tips`; each
event replaces the last on the Overlay. It never touches the Insight lane:
own loop, its own call, never awaited from a bus handler.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

log = logging.getLogger("halo.coach")

INTERVAL_S = 60.0
MIN_NEW_WORDS = 20  # a quiet minute gets no new tips
MAX_WORDS = 3000  # ponytail: newest words only; a summary-of-summaries if meetings run hours
PROMPT_CACHE_KEY = "coach-v1"

TIPS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "tips": {"type": "array", "items": {"type": "string", "minLength": 1, "maxLength": 160},
                 "minItems": 1, "maxItems": 3},
    },
    "required": ["tips"],
    "additionalProperties": False,
}

INSTRUCTIONS = (
    "You coach the person running this meeting, live. Read the meeting so far "
    "and reply with one JSON object: tips, 1 to 3 short tips (each one "
    "sentence, at most 20 words, ending with a period) on how to steer the "
    "meeting right now. Good tips name a person or a topic: a decision with no "
    "owner or date, a question nobody answered, someone who has not spoken, a "
    "topic running long, an agenda item not covered yet. Do not repeat the "
    "previous tips unless still the most useful. Write in the viewer language."
)


class Coach:
    def __init__(self, bus: Any, llm: Any, *, interval_s: float = INTERVAL_S,
                 min_new_words: int = MIN_NEW_WORDS, max_words: int = MAX_WORDS) -> None:
        self._bus = bus
        self._llm = llm
        self._interval = interval_s
        self._min_new = min_new_words
        self._max_words = max_words
        self._turns: dict[str, list[tuple[str, str]]] = {}
        self._new_words: dict[str, int] = {}
        self._contexts: dict[str, dict[str, Any]] = {}
        self._tips: dict[str, list[str]] = {}
        self._task: asyncio.Task | None = None
        bus.subscribe("turn.attributed", self._on_turn)
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
            await asyncio.sleep(self._interval)
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
            self._new_words[meetingid] = self._new_words.get(meetingid, 0) + len(text.split())

    async def _on_context(self, envelope: dict[str, Any]) -> None:
        data, meetingid = envelope.get("data"), envelope.get("meetingid")
        if isinstance(data, dict) and isinstance(meetingid, str):
            self._contexts[meetingid] = data

    async def _on_ended(self, envelope: dict[str, Any]) -> None:
        meetingid = envelope.get("meetingid")
        for store in (self._turns, self._new_words, self._contexts, self._tips):
            store.pop(meetingid, None)

    async def tick(self) -> None:
        """One call per meeting with enough new words (the loop runs it every interval)."""
        for meetingid in [m for m, n in self._new_words.items() if n >= self._min_new]:
            self._new_words[meetingid] = 0
            prompt = self.build_prompt(meetingid)
            result = await asyncio.to_thread(
                self._llm.complete_json, prompt=prompt, schema=TIPS_SCHEMA,
                schema_name="coach.tips", prompt_cache_key=PROMPT_CACHE_KEY)
            if meetingid not in self._turns:
                continue  # the meeting ended during the call
            if result is None or not result.ok or not isinstance(result.data, dict):
                log.warning("coach call failed; next tick tries again")
                self._new_words[meetingid] += self._min_new  # keep it due
                continue
            tips = [str(t).strip() for t in result.data.get("tips", []) if str(t).strip()][:3]
            if not tips:
                continue
            self._tips[meetingid] = tips
            lang = self._contexts.get(meetingid, {}).get("viewer_lang", "en")
            await self._bus.publish({
                "specversion": "1.0", "id": str(uuid.uuid4()), "type": "coach.tips",
                "source": "halo/coach", "time": datetime.now(UTC).isoformat(),
                "meetingid": meetingid, "datacontenttype": "application/json",
                "data": {"tips": [t[:160] for t in tips], "lang": lang if lang in ("en", "ar") else "en"},
            })

    def build_prompt(self, meetingid: str) -> str:
        context = self._contexts.get(meetingid, {})
        lines = [INSTRUCTIONS,
                 (f"Meeting: {context.get('subject') or 'unspecified'} | "
                 f"Viewer language: {context.get('viewer_lang', 'en')}")]
        if context.get("agenda"):
            lines.append("Agenda: " + "; ".join(str(a) for a in context["agenda"]))
        roles = [r for r in context.get("roles") or [] if isinstance(r, dict)]
        if roles:
            lines.append("Roles: " + ", ".join(
                f"{r.get('name')} ({r.get('role')})" if r.get("role") else str(r.get("name"))
                for r in roles))
        if self._tips.get(meetingid):
            lines.append("Previous tips: " + " ".join(self._tips[meetingid]))
        lines.append("The meeting so far:")
        kept: list[str] = []
        budget = self._max_words
        for name, text in reversed(self._turns.get(meetingid, [])):
            budget -= len(text.split())
            if budget < 0:
                break
            kept.append(f"{name}: {text}")
        lines.extend(reversed(kept))
        return "\n".join(lines)
