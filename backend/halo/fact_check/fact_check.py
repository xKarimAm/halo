"""Fact Check: spoken numbers checked against the live web, while the call runs.

A point with a number in it goes to Muse Spark with the web_search tool, one
call at a time on this module's own loop, so the Insight lane never waits. The
model replies `skip` without searching for anything internal to the meeting
(plans, owners, the team's own figures). Only `supported` and `disputed` are
published as `claim.checked`, and the sources are the URLs the search itself
returned, so a link can't be made up by the model.

Karim 2026-11-04: keep API use low. Measured per call: ~2,200 tokens in, ~200
out when it searches (about $0.0003 on the contributor), ~120 in when it skips.
"""

from __future__ import annotations

import asyncio
import logging
import re
import uuid
from datetime import UTC, datetime
from typing import Any

log = logging.getLogger("halo.fact_check")

TICK_S = 1.0
MAX_CALLS = 20  # per meeting: the hard ceiling on spend
MAX_SOURCES = 3
NOTE_MAX = 200
CLAIM_MAX = 300
# ponytail: a digit is the gate; a claim with no number is never checked.
# Widen it (a cheap model gate) if wordy claims turn out to matter.
HAS_NUMBER = re.compile(r"[0-9٠-٩]")

CHECK_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["supported", "disputed", "unclear", "skip"]},
        "note": {"type": "string"},
    },
    "required": ["verdict", "note"],
    "additionalProperties": False,
}

INSTRUCTIONS = (
    "Fact-check one sentence said in a work meeting. If it states a public fact "
    "(world figures, a company, a market, science, history) search the web and "
    "judge it. If it is internal to the meeting (plans, deadlines, owners, the "
    "team's own numbers, opinions) do not search and reply verdict skip.\n"
    "verdict: supported, disputed, unclear or skip.\n"
    "note: one short plain sentence, at most 20 words, giving the correct figure "
    "when disputed, written in {lang}.\n"
    "Said: {claim}"
)


class FactCheck:
    def __init__(self, bus: Any, llm: Any) -> None:
        self._bus = bus
        self._llm = llm
        self._pending: list[tuple[str, dict[str, Any]]] = []
        self._seen: set[str] = set()  # point ids: the Classifier re-upserts them
        self._calls: dict[str, int] = {}
        self._langs: dict[str, str] = {}
        self._task: asyncio.Task | None = None
        bus.subscribe("points.upsert", self._on_point)
        bus.subscribe("meeting.context", self._on_context)

    def start(self) -> None:
        self._task = asyncio.create_task(self._loop())

    def stop(self) -> None:
        if self._task:
            self._task.cancel()

    async def _loop(self) -> None:
        while True:
            try:
                if not await self.tick():
                    await asyncio.sleep(TICK_S)
            except Exception:
                log.exception("fact check failed")
                await asyncio.sleep(TICK_S)

    async def _on_context(self, envelope: dict[str, Any]) -> None:
        lang = envelope.get("data", {}).get("viewer_lang")
        if envelope.get("meetingid") and lang in ("en", "ar"):
            self._langs[envelope["meetingid"]] = lang

    async def _on_point(self, envelope: dict[str, Any]) -> None:
        data = envelope.get("data", {})
        meetingid, point_id = envelope.get("meetingid"), data.get("point_id")
        if not meetingid or not point_id or point_id in self._seen:
            return
        if not HAS_NUMBER.search(str(data.get("text", ""))):
            return
        self._seen.add(point_id)
        if self._calls.get(meetingid, 0) >= MAX_CALLS:
            return
        self._calls[meetingid] = self._calls.get(meetingid, 0) + 1
        self._pending.append((meetingid, data))

    async def tick(self) -> bool:
        """Check the oldest waiting point; False when none is waiting."""
        if not self._pending:
            return False
        meetingid, point = self._pending.pop(0)
        lang = self._langs.get(meetingid, "en")
        claim = str(point["text"])[:CLAIM_MAX]
        prompt = INSTRUCTIONS.format(lang="Arabic" if lang == "ar" else "English", claim=claim)
        result = await asyncio.to_thread(self._llm.search_json, prompt=prompt, schema=CHECK_SCHEMA,
                                         schema_name="claim_check")
        if not result.ok:
            log.warning("fact check call failed: %s", result.error)
            return True
        data = result.data
        sources = data.get("sources", [])[:MAX_SOURCES]
        if data["verdict"] not in ("supported", "disputed") or not sources or not data["note"].strip():
            return True
        await self._bus.publish({
            "specversion": "1.0", "id": str(uuid.uuid4()), "type": "claim.checked",
            "source": "halo/fact_check", "time": datetime.now(UTC).isoformat(),
            "meetingid": meetingid, "datacontenttype": "application/json",
            "data": {"point_id": point["point_id"], "claim": claim,
                     "speaker_name": str(point.get("speaker_name", "")), "verdict": data["verdict"],
                     "note": data["note"].strip()[:NOTE_MAX], "sources": sources, "lang": lang},
        })
        return True
