"""Asyncio EventBus (DECISIONS section 3): publish validates against /contracts and
returns a typed Ack at once; subscribe by type; one Event Store tap; health().
No retries: a throwing subscriber is logged and isolated.
"""

from __future__ import annotations

import inspect
import logging
from collections.abc import Callable
from typing import Any

from contracts.validate import known_type, validate_envelope

log = logging.getLogger("halo.bus")
Envelope = dict[str, Any]
Ack = dict[str, Any]


def _ack(envelope: Envelope, status: str, code: str | None = None, message: str = "") -> Ack:
    ack: Ack = {"ack_of": envelope.get("id", ""), "status": status}
    if code is not None:
        ack["error"] = {"code": code, "message": message}
    return ack


class Bus:
    def __init__(self) -> None:
        self._subs: dict[str, list[Callable[[Envelope], Any]]] = {}
        self._health: dict[str, Callable[[], Any]] = {}
        self._tap: Callable[[Envelope], Any] | None = None

    def subscribe(self, type_: str, fn: Callable[[Envelope], Any]) -> None:
        self._subs.setdefault(type_, []).append(fn)

    def set_tap(self, fn: Callable[[Envelope], Any]) -> None:
        """Register the Event Store tap: it sees every accepted envelope once."""
        self._tap = fn

    def register_health(self, name: str, fn: Callable[[], Any]) -> None:
        self._health[name] = fn

    def health(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for name, fn in self._health.items():
            try:
                out[name] = fn()
            except Exception:  # a failing callable reports down, never raises
                log.exception("health check %s failed", name)
                out[name] = "down"
        return out

    async def publish(self, envelope: Envelope) -> Ack:
        if not known_type(envelope.get("type")):
            return _ack(envelope, "error", "unknown_type", f"unknown type {envelope.get('type')!r}")
        errors = validate_envelope(envelope)
        if errors:
            return _ack(envelope, "error", "invalid_schema", "; ".join(errors))
        if self._tap is not None:
            await self._deliver(self._tap, envelope)
        for fn in list(self._subs.get(envelope.get("type", ""), [])):
            await self._deliver(fn, envelope)
        return _ack(envelope, "ok")

    @staticmethod
    async def _deliver(fn: Callable[[Envelope], Any], envelope: Envelope) -> None:
        try:
            result = fn(envelope)
            if inspect.isawaitable(result):
                await result
        except Exception:
            log.exception("bus subscriber failed for %s", envelope.get("type"))
