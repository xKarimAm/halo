"""Post-hoc tagger: one model call per point fills missing kind/urgency.

A point arrives on `points.upsert`; user (and earlier model) tags arrive on
`tags.set`. Both feed a local mirror with the `tags_effective` layering
(model rows, user rows win per field). Every 10 s tick — or an explicit
`flush()` — each queued point id is checked: fields already present in the
effective tags are skipped, never overridden; only missing fields trigger
exactly one model call, whose answer is published as `tags.set`
(`source: model`). Failed calls stay queued for the next tick.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import UTC, datetime
from typing import Any

log = logging.getLogger("halo.classifier")

Envelope = dict[str, Any]
FIELDS = ("kind", "urgency")
FLUSH_INTERVAL_S = 10.0
FAIL_DOWN_AFTER = 3
PROMPT_CACHE_KEY = "classifier-v1"

TAG_RESULT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["point", "question", "decision", "pushback"]},
        "urgency": {"type": "string", "enum": ["urgent", "medium", "later"]},
    },
    "required": ["kind", "urgency"],
    "additionalProperties": False,
}

INSTRUCTIONS = (
    "You assign tags to a meeting point. Reply with ONE JSON object with "
    "kind (point|question|decision|pushback) and urgency (urgent|medium|later). "
    "Never contradict the current tags below: keep any field they already set. "
    "Classify only from the decision text."
)


class Classifier:
    """User tags win; the model fills exactly what is missing. No SQLite here."""

    def __init__(
        self,
        bus: Any,
        llm: Any,
        *,
        clock: Any = None,
        flush_interval_s: float = FLUSH_INTERVAL_S,
    ) -> None:
        self._bus = bus
        self._llm = llm
        self._clock = clock or time.monotonic
        self._flush_interval = flush_interval_s
        self._queued: dict[tuple[str, str], tuple[str, dict[str, Any]]] = {}
        self._user_tags: dict[tuple[str, str], dict[str, str]] = {}
        self._model_tags: dict[tuple[str, str], dict[str, str]] = {}
        self._consecutive_failures = 0
        self._task: asyncio.Task | None = None
        bus.subscribe("points.upsert", self._on_point)
        bus.subscribe("tags.set", self._on_tags)

    def health(self) -> str:
        """System-status `tagger` slot: ok unless the model keeps failing."""
        return "down" if self._consecutive_failures >= FAIL_DOWN_AFTER else "ok"

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

    async def _on_point(self, envelope: Envelope) -> None:
        data = envelope.get("data")
        meetingid = envelope.get("meetingid")
        if not isinstance(data, dict) or not isinstance(meetingid, str):
            return
        point_id = data.get("point_id")
        if not isinstance(point_id, str):
            return
        self._queued[("point", point_id)] = (meetingid, data)

    async def _on_tags(self, envelope: Envelope) -> None:
        data = envelope.get("data")
        if not isinstance(data, dict):
            return
        target, target_id = data.get("target"), data.get("target_id")
        if target not in ("point", "action") or not isinstance(target_id, str):
            return
        key = (target, target_id)
        fields = {f: data[f] for f in FIELDS if isinstance(data.get(f), str)}
        if not fields:
            return
        store = self._user_tags if data.get("source") == "user" else self._model_tags
        store[key] = {**store.get(key, {}), **fields}

    # -- flushing ----------------------------------------------------------

    def effective(self, key: tuple[str, str]) -> dict[str, str]:
        """The `tags_effective` layering over the local mirror."""
        return {**self._model_tags.get(key, {}), **self._user_tags.get(key, {})}

    async def flush(self) -> None:
        for key, queued in list(self._queued.items()):
            del self._queued[key]
            await self._flush_one(key, *queued)

    async def _flush_one(
        self, key: tuple[str, str], meetingid: str, point: dict[str, Any]
    ) -> None:
        current = self.effective(key)
        missing = [f for f in FIELDS if f not in current]
        if not missing:
            return
        prompt = self.build_prompt(point, current)
        result = await asyncio.to_thread(
            self._llm.complete_json,
            prompt=prompt,
            schema=TAG_RESULT_SCHEMA,
            schema_name="classifier.tags",
            prompt_cache_key=PROMPT_CACHE_KEY,
        )
        if not result.ok or not isinstance(result.data, dict):
            log.warning("classifier call failed for %s, kept queued", key[1])
            self._queued[key] = (meetingid, point)
            self._consecutive_failures += 1
            return
        self._consecutive_failures = 0
        answer = {f: result.data[f] for f in missing if isinstance(result.data.get(f), str)}
        if not answer:
            return
        self._model_tags[key] = {**self._model_tags.get(key, {}), **answer}
        await self._bus.publish({
            "specversion": "1.0",
            "id": str(uuid.uuid4()),
            "type": "tags.set",
            "source": "halo/classifier",
            "time": datetime.now(UTC).isoformat(),
            "meetingid": meetingid,
            "datacontenttype": "application/json",
            "data": {"target": key[0], "target_id": key[1], "source": "model",
                     "model": result.engine, **answer},
        })

    # -- prompt --------------------------------------------------------------

    def build_prompt(self, point: dict[str, Any], current: dict[str, str]) -> str:
        lines = [INSTRUCTIONS]
        if current:
            lines.append("Current tags (keep these): " + ", ".join(f"{k}={v}" for k, v in current.items()))
        else:
            lines.append("Current tags: none yet.")
        lines.append(f"Decision text: {point.get('text', '')}")
        if point.get("quote"):
            lines.append(f"Original words: {point['quote']}")
        return "\n".join(lines)
