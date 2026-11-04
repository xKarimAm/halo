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
import re
import time
import uuid
from datetime import UTC, datetime
from typing import Any

log = logging.getLogger("halo.coach")

TICK_S = 1.0
MIN_GAP_S = 8.0  # ponytail: one call per 8 s per meeting at most (~7 RPM); raise if RPM gets tight
SILENCE_S = 15.0  # one silence call per quiet stretch
MAX_WORDS = 2000  # newest words only; shorter input, faster call
ALERT_GAP_S = 180.0  # live 2026-11-04: at most one alert per 3 minutes
MAX_SAID = 12  # earlier tips kept in the prompt so they are not reworded (live 2026-11-04)
PROMPT_CACHE_KEY = "coach-v4"

TIPS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "tips": {"type": "array", "items": {"type": "string", "minLength": 1, "maxLength": 160},
                 "maxItems": 3},
        "alert": {"type": "string", "maxLength": 80},
        # The exact words that prove the alert; no match in the transcript, no alert.
        "alert_quote": {"type": "string", "maxLength": 120},
    },
    "required": ["tips", "alert", "alert_quote"],
    "additionalProperties": False,
}

# Live 2026-11-02: alone in the call, the viewer named Sarah, John and Lisa
# and got "Let them finish." Telling the model who is present made calls 7-10 s
# (A/B: 4.8 s median vs timeouts), so the prompt stays fixed and _publish drops
# a talk-over alert when nobody else is in the call.
# ponytail: keyword match on the alert; a model paraphrase can slip past it.
TALK_OVER_WORDS = ("invite", "let them", "finish", "floor", "interrupt", "talking over")
INSTRUCTIONS = (
    "You are a live meeting coach whispering to one person, the viewer. Talk "
    "to them as you. Coach the way a strong coach for their role would. "
    "Reply with one JSON object.\n"
    # Live 2026-11-04: 5 alerts in 9 min, all false and cryptic ("Park it: get
    # Qatar fact."). Plain words, a quote as proof, and most calls need none.
    "alert: almost always empty. Only for a clear moment the viewer must act "
    "on now, in plain words (at most 10, ending with a period), with "
    "alert_quote set to the exact words someone said that show it. "
    "Someone attacks a person, not the idea (you always, typical of you): "
    "<name> is getting personal; bring it back to <topic>. Two people or "
    "teams blame each other, back and forth (every time you..., it's not my "
    "problem that...): Stop the blame; put the options on the table. The "
    "viewer starts "
    "talking while someone is mid-sentence, twice: You talked over <name>; "
    "let them finish. The viewer insults, mocks or shouts: Take a breath; "
    "your tone is rising. The same claim said three times by two people "
    "with no new fact: This keeps coming back; agree to check <fact> later. "
    "The viewer talks for minutes while others wait: Pause and ask the "
    "others. Not an alert: disagreement, a firm no, a joke, testing the app, "
    "reading text aloud, or one short interruption. Never add a name, owner "
    "or date nobody said. An empty alert has an empty alert_quote.\n"
    "tips: 0 to 3, each one sentence of at most 16 words ending with a "
    "period. Each tip names one concrete item from the recent words: a "
    "number, a claim nobody has checked (on paper, a guess, from the docs), "
    "a question nobody answered, an option nobody named, a decision with no "
    "owner or date, someone who has not spoken. Role gaps: for a product "
    "manager, the user problem and its evidence, a success metric, scope "
    "against value, a staged rollout, the revenue link; for sales, dig into "
    "the objection before discounting, who signs off, a next step with a "
    "date. An item is closed once it has an owner, a day (today, tomorrow, "
    "Thursday) and a spoken yes; never tip on a closed item, not even to "
    "confirm it. When someone wraps up (that's all, next item, I'll send it) "
    "while an item is open, tip on it now; a vague follow-up needs a date. "
    "Silence after a "
    "question is thinking time: wait, then rephrase it or ask one person.\n"
    "Return empty tips when the previous tips still fit or everything is "
    "settled; never repeat or reword a previous tip. Write the tips and the "
    "whole alert, its lead-in too, in the viewer language (Arabic: تدخل: …)."
)
# Live 2026-11-04 (alone, testing): "open with the one number" he never said,
# "drop the Arabic aside", his own sentences echoed back as orders.
REHEARSAL = ("The viewer is alone in the call, rehearsing or testing: names are the "
             "future audience, so never tell them to ask or invite anyone, and a "
             "silence is a break (empty tips). Tips only on how they said their own "
             "words: put their main point first, cut filler, keep the stronger of two "
             "versions of a line. Never ask for a number, fact or deadline they did not "
             "say. Mixing Arabic and English is normal: never tip on language. Never "
             "turn their sentence into an order. Each kind of tip (main point first, "
             "cut filler, keep a line) at most once per meeting. Most moments need "
             "no tip: return empty tips unless one would change what they say next.")


def _norm(text: str) -> str:
    """Lower case, punctuation to spaces, single spaces (Arabic letters kept)."""
    return " ".join(re.sub(r"[^\w\s]", " ", text.lower()).split())


def _alert_kind(alert: str) -> str:
    """'Park it: Rami...' and 'Park it Rami...' are one kind: the first two words.
    ponytail: two-word prefix; two different alerts sharing it count as one."""
    return " ".join(re.sub(r"[^\w\s]", " ", alert.lower()).split()[:2])


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
        self._people: dict[str, list[str]] = {}  # who is in the call (Meet tiles)
        self._tips: dict[str, list[str]] = {}
        self._said: dict[str, list[str]] = {}  # every tip shown this meeting, newest last
        self._last_alert: dict[str, float] = {}
        self._shown_alerts: dict[str, list[str]] = {}  # normalised, to spot one read aloud
        self._alerts: dict[str, set[str]] = {}  # alert kinds already shown: never the same one twice
        self._ended: set[str] = set()  # late turns after meeting.ended are ignored
        self._due: set[str] = set()  # new words since the last call
        self._last_turn: dict[str, float] = {}
        self._last_call: dict[str, float] = {}
        self._silence_spent: set[str] = set()
        self._task: asyncio.Task | None = None
        bus.subscribe("turn.attributed", self._on_turn)
        bus.subscribe("meeting.started", self._on_started)
        bus.subscribe("tiles.snapshot", self._on_tiles)
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
        if text and meetingid not in self._ended:
            self._turns.setdefault(meetingid, []).append((str(data.get("name") or "?"), text))
            self._due.add(meetingid)
            self._last_turn[meetingid] = self._clock()
            self._silence_spent.discard(meetingid)

    async def _on_started(self, envelope: dict[str, Any]) -> None:
        data, meetingid = envelope.get("data"), envelope.get("meetingid")
        if isinstance(data, dict) and isinstance(meetingid, str) and data.get("self_name"):
            self._self_names[meetingid] = str(data["self_name"])

    async def _on_tiles(self, envelope: dict[str, Any]) -> None:
        """The self tile names the viewer when meeting.started had no self_name
        (live 2026-11-02: it came empty, and the coach said "Ask Karim")."""
        data, meetingid = envelope.get("data"), envelope.get("meetingid")
        if not isinstance(data, dict) or not isinstance(meetingid, str):
            return
        tiles = [t for t in data.get("tiles") or [] if isinstance(t, dict) and t.get("name")]
        self._people[meetingid] = [str(t["name"]) for t in tiles]
        if self._self_names.get(meetingid):
            return
        me = next((t["name"] for t in tiles if t.get("is_self")), None)
        if me:
            self._self_names[meetingid] = str(me)

    async def _on_context(self, envelope: dict[str, Any]) -> None:
        data, meetingid = envelope.get("data"), envelope.get("meetingid")
        if isinstance(data, dict) and isinstance(meetingid, str):
            self._contexts[meetingid] = data

    async def _on_ended(self, envelope: dict[str, Any]) -> None:
        meetingid = envelope.get("meetingid")
        if not isinstance(meetingid, str):
            return
        self._ended.add(meetingid)
        for store in (self._turns, self._contexts, self._self_names, self._tips, self._said, self._people, self._alerts,
                      self._last_alert, self._shown_alerts,
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
        alert = re.sub(r"^(alert|تنبيه)\s*:\s*", "", str(data.get("alert") or "").strip(), flags=re.IGNORECASE)[:80]
        if alert and not self._proven(meetingid, str(data.get("alert_quote") or "")):
            alert = ""  # live 2026-11-04: alerts on words nobody said, or on a read-aloud alert
        if alert and self._clock() - self._last_alert.get(meetingid, -ALERT_GAP_S) < ALERT_GAP_S:
            alert = ""
        if alert and not self._others_here(meetingid) and any(w in alert.lower() for w in TALK_OVER_WORDS):
            alert = ""  # nobody to talk over
        if _alert_kind(alert) in self._alerts.get(meetingid, set()):
            alert = ""  # eval: the same alert kind, reworded, fired loop after loop
        if not tips and not alert:
            return  # nothing new for the viewer: the panel keeps its tips
        said = self._said.setdefault(meetingid, [])
        said.extend(t for t in tips if t not in said)
        del said[:-MAX_SAID]
        tips = tips or self._tips.get(meetingid, [])
        self._tips[meetingid] = tips
        lang = self._contexts.get(meetingid, {}).get("viewer_lang", "en")
        payload: dict[str, Any] = {"tips": tips, "lang": lang if lang in ("en", "ar") else "en"}
        if alert:
            payload["alert"] = alert
            self._alerts.setdefault(meetingid, set()).add(_alert_kind(alert))
            self._shown_alerts.setdefault(meetingid, []).append(_norm(alert))
            self._last_alert[meetingid] = self._clock()
        await self._bus.publish({
            "specversion": "1.0", "id": str(uuid.uuid4()), "type": "coach.tips",
            "source": "halo/coach", "time": datetime.now(UTC).isoformat(),
            "meetingid": meetingid, "datacontenttype": "application/json", "data": payload,
        })

    def _proven(self, meetingid: str, quote: str) -> bool:
        """The quote is in the recent words, and is not a shown alert read aloud."""
        q = _norm(quote)
        if len(q.split()) < 2:
            return False
        recent = _norm(" ".join(text for _, text in self._turns.get(meetingid, [])[-30:]))
        if q not in recent:
            return False
        return not any(a in q or q in a for a in self._shown_alerts.get(meetingid, []))

    def _others_here(self, meetingid: str) -> bool:
        """Meet tiles say who is in the call; without them, any other speaker."""
        people = self._people.get(meetingid)
        if people:
            return len(people) > 1
        me = self._self_names.get(meetingid, "")
        return any(name != me for name, _ in self._turns.get(meetingid, []))

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
        if not self._others_here(meetingid):
            lines.append(REHEARSAL)
        if roles:
            lines.append("Roles: " + ", ".join(
                f"{r.get('name')} ({r.get('role')})" if r.get("role") else str(r.get("name"))
                for r in roles))
        if self._said.get(meetingid):
            lines.append("Previous tips: " + " ".join(self._said[meetingid]))
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
