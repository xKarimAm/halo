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
COACH_TIMEOUT_S = 8.0  # live 2026-11-04: 14 coach timeouts at 4 s, each demoting live points for 30 s
ALERT_GAP_S = 180.0  # live 2026-11-04: at most one alert per 3 minutes
MAX_SAID = 12  # earlier tips kept in the prompt so they are not reworded (live 2026-11-04)
PROMPT_CACHE_KEY = "coach-v5"

TIPS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        # Karim 2026-11-16: "tell me what is going on"; one line above the tips.
        "read": {"type": "string", "maxLength": 160},
        "tips": {"type": "array", "items": {"type": "string", "minLength": 1, "maxLength": 160},
                 "maxItems": 3},
        "alert": {"type": "string", "maxLength": 80},
        # The exact words that prove the alert; no match in the transcript, no alert.
        "alert_quote": {"type": "string", "maxLength": 120},
    },
    "required": ["read", "tips", "alert", "alert_quote"],
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
    # Karim 2026-11-16: tips felt superficial ("keep one That is pretty great").
    "read: one sentence of at most 20 words on what is going on right now, "
    "from the viewer's side: the stage (opening, discussion, deciding, "
    "wrap-up), the topic in their words, and the one thing missing. Use the "
    "speech numbers; give minutes only when they list them. Talk to the "
    "viewer as you. Opening with mic checks, small talk or side chat and no "
    "topic yet: say so (Opening: mic checks and side chat; no topic or goal "
    "yet.). Empty only when nothing has been said.\n"
    "tips: 0 to 3 constructive tips, each ONE sentence of at most 20 words "
    "ending with a period: what you noticed, then what to do next, with the "
    "words to say when it helps (No goal stated yet: open with 'Today we "
    "decide the launch date.'). Feedback on the viewer's own speaking "
    "counts: a long monologue, no questions asked, filler, the main point "
    "buried, an ask with no deadline. Quote the speech numbers only as "
    "given. Never praise, never echo a line back to polish it; mic checks "
    "and side chat are an opening problem, not lines to edit. Each tip "
    "names one concrete item from the recent words: a "
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
    "tips is the whole list the viewer sees next: keep a tip on screen word "
    "for word while it still applies, drop it once it is settled, add one "
    "only for a new item; never reword a tip or bring back one shown "
    "earlier. Everything settled: empty tips. Write the tips and the "
    "whole alert, its lead-in too, and the read in the viewer language "
    "(Arabic: تدخل: …)."
)
# Live 2026-11-04 (alone, testing): "open with the one number" he never said,
# "drop the Arabic aside", his own sentences echoed back as orders.
# Karim 2026-11-16: alone and rambling, he wants the read and real feedback on delivery.
REHEARSAL = ("The viewer is alone in the call, rehearsing or testing: names are the "
             "future audience, so never tell them to ask or invite anyone, and a "
             "silence is a break (empty tips). Coach their delivery: a clear opening "
             "(topic and goal in the first minute), main point first, structure, "
             "pace, filler, one idea per sentence. Never ask for a number, fact or "
             "deadline they did not say. Mixing Arabic and English is normal: never "
             "tip on language. Never turn their sentence into an order. Each kind of "
             "tip at most once per meeting. Alone, talk share and questions asked "
             "say nothing: never tell them to invite, ask or let anyone speak.")
SHARE_MIN_WORDS = 80  # ponytail: talk share means little before about half a minute of talk
FILLER = re.compile(r"\b(um+|uh+|erm|you know|basically|kind of|sort of|i mean)\b|يعني", re.IGNORECASE)


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
        self._spoken_ms: dict[str, dict[str, int]] = {}  # per speaker, from turn times
        self._span: dict[str, list[int]] = {}  # first start, last end (ms)
        self._reads: dict[str, str] = {}
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
            name = str(data.get("name") or "?")
            self._turns.setdefault(meetingid, []).append((name, text))
            start, end = int(data.get("ts_start_ms") or 0), int(data.get("ts_end_ms") or 0)
            if end > start:
                spoken = self._spoken_ms.setdefault(meetingid, {})
                spoken[name] = spoken.get(name, 0) + end - start
                span = self._span.setdefault(meetingid, [start, end])
                span[0], span[1] = min(span[0], start), max(span[1], end)
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
        for store in (self._turns, self._spoken_ms, self._span, self._reads, self._contexts, self._self_names, self._tips, self._said, self._people, self._alerts,
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
                schema=TIPS_SCHEMA, schema_name="coach.tips", prompt_cache_key=PROMPT_CACHE_KEY,
                timeout_s=COACH_TIMEOUT_S)
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
        read = str(data.get("read") or "").strip()[:160]
        if not read and not tips and not alert:
            return  # an empty reply: the panel keeps what it shows
        if alert and not tips:
            tips = self._tips.get(meetingid, [])  # an alert rides on the tips on screen
        read = read or self._reads.get(meetingid, "")
        # Blind eval 2026-11-16: carried-over tips contradicted a new read ("all
        # settled"), so the reply is the whole list now and empty tips clear it.
        if not alert and tips == self._tips.get(meetingid, []) and read == self._reads.get(meetingid):
            return  # nothing changed on screen
        self._reads[meetingid] = read
        said = self._said.setdefault(meetingid, [])
        said.extend(t for t in tips if t not in said)
        del said[:-MAX_SAID]
        self._tips[meetingid] = tips
        lang = self._contexts.get(meetingid, {}).get("viewer_lang", "en")
        payload: dict[str, Any] = {"tips": tips, "lang": lang if lang in ("en", "ar") else "en"}
        if read:
            payload["read"] = read
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
            lines.append("Tips shown earlier: " + " ".join(self._said[meetingid]))
        if self._tips.get(meetingid):
            lines.append("Tips on screen now: " + " | ".join(self._tips[meetingid]))
        lines.append(self.speech(meetingid))
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

    def speech(self, meetingid: str) -> str:
        """Speech numbers for the read and the delivery tips (Karim 2026-11-16).
        Counted from words, so they hold without turn times (the eval has none);
        minutes and pace come from the turn times when there are any.
        ponytail: a fixed filler list; "like" is left out on purpose (too often real)."""
        turns = self._turns.get(meetingid, [])
        me = self._self_names.get(meetingid, "")
        words = sum(len(t.split()) for _, t in turns)
        mine = [t for n, t in turns if me and n == me]
        my_words = sum(len(t.split()) for t in mine)
        run = longest = 0
        for name, text in turns:
            run = run + len(text.split()) if me and name == me else 0
            longest = max(longest, run)
        parts = [f"your longest unbroken stretch {longest} words",
                 f"questions you asked {sum(t.count('?') + t.count('؟') for t in mine)}",
                 f"filler words {sum(len(FILLER.findall(t)) for t in mine)}"]
        if words >= SHARE_MIN_WORDS:  # eval: "you spoke 100%, ask Sara" three lines in
            parts.insert(0, f"you said {round(100 * my_words / words)}% of {words} words")
        span = self._span.get(meetingid)
        if span:
            parts.insert(0, f"{(span[1] - span[0]) / 60000:.0f} min in")
            my_ms = self._spoken_ms.get(meetingid, {}).get(me, 0)
            if my_ms >= 20000:
                parts.append(f"your pace {my_words / (my_ms / 60000):.0f} words per minute")
        return "Speech so far: " + "; ".join(parts) + "."
