"""Correlator: attach a tile + name to every final turn.

Mic turns lock to the self tile. Tab turns go to the tile lit when the turn
started (provisional); three agreeing turns lock a diarized speaker, emitting
speaker.mapped (with corrects[] when the lock moves). Two lit tiles mean
overlap. A headset-echo mic line repeating a tab line is dropped. Tab turns
before any snapshot are held (max HOLD_TIMEOUT_S), then released or dropped
with a warning -- the only drop.
"""

from __future__ import annotations

import asyncio
import datetime
import logging
import re
import uuid
from typing import Any

log = logging.getLogger("halo.correlator")

Envelope = dict[str, Any]

# Tunable constants (module-owned, not contract): Meet's speaking highlight
# trails audio, hence the lag knob. Karim tunes them on recorded calls (L4).
LAG_MS = 500
LOCK_AFTER = 3
ECHO_WINDOW_MS = 2000
HOLD_TIMEOUT_S = 10
UNLABELED = ("", "?")  # transcriber pieces cut before Voice labels the turn


def _utcnow() -> str:
    return datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z")


def _norm_text(text: str) -> str:
    return re.sub(r"[^a-z0-9\u0600-\u06ff]+", " ", text.lower()).strip()


class Correlator:
    def __init__(
        self,
        bus: Any,
        lag_ms: int = LAG_MS,
        lock_after: int = LOCK_AFTER,
        echo_window_ms: int = ECHO_WINDOW_MS,
        hold_timeout_s: float = HOLD_TIMEOUT_S,
    ) -> None:
        self._bus = bus
        self._lag_ms = lag_ms
        self._lock_after = lock_after
        self._echo_window_ms = echo_window_ms
        self._hold_timeout_s = hold_timeout_s
        self._meetingid = ""
        self._tiles: dict[str, dict[str, Any]] = {}
        self._lit: dict[str, tuple[bool, int]] = {}
        self._last_active: dict[str, int] = {}
        self._locks: dict[str, str] = {}
        self._history: dict[str, list[tuple[str, str]]] = {}
        self._tab_lines: list[tuple[str, int]] = []
        self._held: list[dict[str, Any]] = []
        self._hold_timer: Any = None
        bus.subscribe("transcript.final", self._on_final)
        bus.subscribe("tiles.snapshot", self._on_snapshot)
        bus.subscribe("speaker.active", self._on_active)
        bus.subscribe("meeting.started", self._on_lifecycle)
        bus.subscribe("meeting.ended", self._on_lifecycle)
        bus.register_health("correlator", self.health_status)

    # -- bus -----------------------------------------------------------

    async def _on_lifecycle(self, envelope: Envelope) -> None:
        if envelope.get("type") == "meeting.started":
            meeting_id = str(envelope.get("data", {}).get("meeting_id", ""))
            if meeting_id and meeting_id == self._meetingid:
                return  # a replayed started (issue #57) keeps tiles and locks
            self._meetingid = meeting_id
        self._reset()

    def _reset(self) -> None:
        self._tiles = {}
        self._lit = {}
        self._last_active = {}
        self._locks = {}
        self._history = {}
        self._tab_lines = []
        self._held = []
        self._cancel_hold_timer()

    async def _on_snapshot(self, envelope: Envelope) -> None:
        tiles = {}
        for tile in envelope.get("data", {}).get("tiles", []):
            tiles[tile["tile_id"]] = {"name": tile["name"], "is_self": tile["is_self"]}
        self._tiles = tiles
        if self._held:
            held, self._held = self._held, []
            self._cancel_hold_timer()
            for turn in held:
                if str(turn.get("stream", "tab")) == "mic":
                    await self._attribute_mic(turn)
                else:
                    await self._attribute_tab(turn, held_release=True)

    async def _on_active(self, envelope: Envelope) -> None:
        data = envelope.get("data", {})
        tile_id = str(data.get("tile_id", ""))
        speaking = bool(data.get("speaking", False))
        ts = int(data.get("ts_ms", 0))
        self._lit[tile_id] = (speaking, ts)
        self._last_active[tile_id] = ts

    async def _on_final(self, envelope: Envelope) -> None:
        data = envelope.get("data", {})
        stream = str(data.get("stream", "tab"))
        if stream == "mic":
            await self._attribute_mic(data)
            return
        if not self._tiles:
            self._hold(data)
            return
        await self._attribute_tab(data)
        if self._held and self._tiles:
            held, self._held = self._held, []
            self._cancel_hold_timer()
            for turn in held:
                if str(turn.get("stream", "tab")) == "mic":
                    await self._attribute_mic(turn)
                else:
                    await self._attribute_tab(turn, held_release=True)

    # -- attribution ---------------------------------------------------

    def _self_tile(self) -> tuple[str, dict[str, Any]] | None:
        for tile_id, tile in self._tiles.items():
            if tile["is_self"]:
                return tile_id, tile
        return None

    def _lit_at(self, ts_start_ms: int) -> list[str]:
        horizon = ts_start_ms + self._lag_ms
        return [
            tile_id
            for tile_id, (speaking, ts) in self._lit.items()
            if speaking and ts <= horizon and tile_id in self._tiles
        ]

    def _best_available(self, exclude_self: bool = True) -> tuple[str, dict[str, Any]] | None:
        ids = list(self._tiles)
        if exclude_self:
            non_self = [i for i in ids if not self._tiles[i]["is_self"]]
            if non_self:
                ids = non_self
        if not ids:
            return None
        best = max(ids, key=lambda i: (self._last_active.get(i, -1), i))
        return best, self._tiles[best]

    async def _attribute_mic(self, data: dict[str, Any]) -> None:
        if self._is_echo(data):
            log.info("correlator echo drop: turn=%s", data.get("turn_id"))
            return
        target = self._self_tile()
        if target is None:
            self._hold(data)
            return
        tile_id, tile = target
        await self._emit_turn(data, tile_id, tile["name"], "locked", overlap=False)

    async def _attribute_tab(self, data: dict[str, Any], held_release: bool = False) -> None:
        speaker = str(data.get("speaker", ""))
        ts_start = int(data.get("ts_start_ms", 0))
        lit = self._lit_at(ts_start)
        overlap = len(lit) >= 2
        if speaker in self._locks and self._locks[speaker] in self._tiles:
            tile_id = self._locks[speaker]
            await self._emit_turn(data, tile_id, self._tiles[tile_id]["name"], "locked", overlap)
            return
        if lit:
            chosen = max(lit, key=lambda i: (self._last_active.get(i, 0), i))
        else:
            best = self._best_available()
            if best is None:
                self._hold(data)
                return
            chosen, _ = best
        if speaker in UNLABELED:
            # Soft-cut pieces go out before Voice labels the turn (the label
            # lands at turn end). Locking "?" pinned every later piece, of
            # any speaker, to the first tile (live 2026-10-31): stay on the
            # lit tile, provisional, and never lock or learn from it.
            await self._emit_turn(data, chosen, self._tiles[chosen]["name"], "provisional", overlap)
        else:
            await self._attribute_labeled(data, speaker, chosen, overlap)
        if not held_release:
            self._tab_lines.append((_norm_text(str(data.get("text", ""))), ts_start))
            self._tab_lines = self._tab_lines[-20:]

    async def _attribute_labeled(self, data: dict[str, Any], speaker: str, chosen: str,
                                 overlap: bool) -> None:
        history = self._history.setdefault(speaker, [])
        history.append((str(data.get("turn_id", "")), chosen))
        recent = history[-self._lock_after:]
        if len(recent) >= self._lock_after and len({t for _, t in recent}) == 1:
            await self._lock(speaker, chosen)
            await self._emit_turn(data, chosen, self._tiles[chosen]["name"], "locked", overlap)
        else:
            await self._emit_turn(data, chosen, self._tiles[chosen]["name"], "provisional", overlap)

    async def _lock(self, speaker: str, tile_id: str) -> None:
        previous = [(tid, t) for tid, t in self._history.get(speaker, []) if t != tile_id]
        self._locks[speaker] = tile_id
        mapping: dict[str, Any] = {
            "speaker": speaker,
            "tile_id": tile_id,
            "name": self._tiles[tile_id]["name"],
            "locked": True,
        }
        if previous:
            mapping["corrects"] = [tid for tid, _ in previous]
        await self._bus.publish({
            "specversion": "1.0",
            "id": str(uuid.uuid4()),
            "type": "speaker.mapped",
            "source": "halo/correlator",
            "time": _utcnow(),
            "meetingid": self._meetingid,
            "datacontenttype": "application/json",
            "data": mapping,
        })

    # -- echo / hold ---------------------------------------------------

    def _is_echo(self, data: dict[str, Any]) -> bool:
        text = _norm_text(str(data.get("text", "")))
        if not text:
            return False
        ts = int(data.get("ts_start_ms", 0))
        return any(
            line == text and abs(ts - line_ts) <= self._echo_window_ms
            for line, line_ts in self._tab_lines
        )

    def _hold(self, data: dict[str, Any]) -> None:
        self._held.append(data)
        if self._hold_timer is None:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                return
            self._hold_timer = loop.call_later(self._hold_timeout_s, self._expire_holds)

    def _expire_holds(self) -> None:
        self._hold_timer = None
        held, self._held = self._held, []
        for turn in held:
            log.warning("correlator dropping held turn: turn=%s (no snapshot in %ss)",
                        turn.get("turn_id"), self._hold_timeout_s)

    def _cancel_hold_timer(self) -> None:
        if self._hold_timer is not None:
            self._hold_timer.cancel()
            self._hold_timer = None

    # -- emit ----------------------------------------------------------

    async def _emit_turn(
        self, data: dict[str, Any], tile_id: str, name: str, attribution: str, overlap: bool
    ) -> None:
        await self._bus.publish({
            "specversion": "1.0",
            "id": str(uuid.uuid4()),
            "type": "turn.attributed",
            "source": "halo/correlator",
            "time": _utcnow(),
            "meetingid": self._meetingid,
            "datacontenttype": "application/json",
            "data": {
                "turn_id": data.get("turn_id"),
                "text": data.get("text"),
                "lang": data.get("lang"),
                "ts_start_ms": data.get("ts_start_ms"),
                "ts_end_ms": data.get("ts_end_ms"),
                "tile_id": tile_id,
                "name": name,
                "attribution": attribution,
                "overlap": overlap,
            },
        })

    def health_status(self) -> str:
        return "ok"
