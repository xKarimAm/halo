"""Per-socket envelope handling: pairing gate, validation, dedupe, bus ACK.

Transport-free: the router's socket loop calls `handle_text` and sends the
returned reply; broadcasts call `session.send`. `pair.hello` is answered by a
`pair.ok`/`pair.rejected` envelope (that reply *is* its ACK). Every other
envelope gets an ACK dict mirroring the bus ack, after gateway-global id
dedupe (so a resend on a reconnected socket is not re-published).
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

from contracts.validate import known_type, validate_envelope

Envelope = dict[str, Any]

#: Bus types the Gateway forwards to paired sockets (the Overlay).
FORWARD_TYPES = ("points.upsert", "tags.set", "speaker.mapped", "notes.ready")


def _ack(ack_of: object, status: str, code: str | None = None, message: str = "") -> dict[str, Any]:
    ack: dict[str, Any] = {"ack_of": ack_of if isinstance(ack_of, str) else "", "status": status}
    if code is not None:
        ack["error"] = {"code": code, "message": message}
    return ack


class SocketSession:
    def __init__(self, gateway: Any) -> None:
        self._gateway = gateway
        self.paired = False
        self.session_id: str | None = None
        self.sender: Callable[[Envelope], Awaitable[None]] | None = None

    async def send(self, envelope: Envelope) -> None:
        if self.sender is not None and self.paired:
            await self.sender(envelope)

    async def handle_text(self, raw: str) -> dict[str, Any]:
        try:
            msg = json.loads(raw)
        except ValueError:
            return _ack("", "error", "invalid_schema", "not JSON")
        if not isinstance(msg, dict):
            return _ack("", "error", "invalid_schema", "not an object")
        if msg.get("type") == "pair.hello":
            return self._hello(msg)
        if not self.paired:
            return _ack(msg.get("id"), "error", "unpaired", "pair first")
        mtype = msg.get("type")
        if not known_type(mtype):
            return _ack(msg.get("id"), "error", "unknown_type", f"unknown type {mtype!r}")
        errors = validate_envelope(msg)
        if errors:
            return _ack(msg.get("id"), "error", "invalid_schema", "; ".join(errors))
        mid = msg["id"]
        if self._gateway.deduped(mid):
            return _ack(mid, "ok")
        ack = await self._gateway.bus.publish(msg)
        reply: dict[str, Any] = {"ack_of": mid, "status": ack["status"]}
        if ack.get("error") is not None:
            reply["error"] = ack["error"]
        return reply

    def _hello(self, msg: Envelope) -> Envelope:
        if validate_envelope(msg):
            return self._gateway.envelope("pair.rejected", {"reason": "invalid hello"}, msg.get("meetingid"))
        token = msg["data"].get("token") if isinstance(msg.get("data"), dict) else None
        if not self._gateway.pairing.check(token):
            return self._gateway.envelope("pair.rejected", {"reason": "unknown token"}, msg.get("meetingid"))
        self.paired = True
        self.session_id = self._gateway.new_session_id()
        return self._gateway.envelope("pair.ok", {"session_id": self.session_id}, msg.get("meetingid"))
