"""Muse Voice Transcribe realtime protocol helpers (pure, no I/O).

Handshake goes in the first JSON frame (the HTTP Authorization header is
ignored on this endpoint). Turn events are keyed by turnId because
speechComplete arrives asynchronously, never in arrival order.
"""

from __future__ import annotations

from typing import Any

DIARIZATION = "DIARIZATION"
ENDPOINTING = "ENDPOINTING"

LANGUAGE_BIAS = ["arabic", "english"]


def build_handshake(mode: str, key: str, keywords: list[str] | None = None) -> dict[str, Any]:
    """First JSON frame: Bearer auth + fixed session mode + ASR hints."""
    return {
        "authorization": {"accessToken": f"Bearer {key}"},
        "mode": mode,
        "languageBias": list(LANGUAGE_BIAS),
        "keywords": list(keywords or []),
    }


def normalize_lang(raw: Any) -> str:
    """Map engine language labels onto the contract ar|en|mixed."""
    text = str(raw or "").strip().lower()
    if text in ("ar", "arabic", "ara"):
        return "ar"
    if text in ("en", "english", "eng"):
        return "en"
    if text in ("mixed", "code-switch", "code_switch"):
        return "mixed"
    return "mixed"


class TurnAssembler:
    """Assembles final turns from the turn lifecycle, keyed by turnId.

    Partials are cumulative (each replaces the last); a `speaker` event
    labels the span before it; `final: true` (or speechComplete) completes.
    Completed turns carry offsets relative to session audio; the session
    maps them onto the meeting clock with its anchor.
    """

    def __init__(self) -> None:
        self._text: dict[str, str] = {}
        self._speaker: dict[str, str | None] = {}
        self._lang: dict[str, str] = {}
        self._start: dict[str, int] = {}
        self._end: dict[str, int] = {}
        self._last_speaker: str | None = None
        self._done: set[str] = set()

    def handle(self, message: dict[str, Any]) -> dict[str, Any] | None:
        """Feed one server message; returns the completed turn or None."""
        mtype = message.get("type")
        turn_id = message.get("turnId")
        if not isinstance(turn_id, str) or not turn_id:
            return None
        if mtype == "speechStart":
            self._text[turn_id] = ""
            self._speaker[turn_id] = None
            return None
        if turn_id not in self._text and mtype != "speechComplete":
            self._text[turn_id] = ""
            self._speaker[turn_id] = None
        if mtype == "partial":
            if isinstance(message.get("text"), str):
                self._text[turn_id] = message["text"]
            if message.get("final") is True:
                return self._complete(turn_id)
            return None
        if mtype == "speaker":
            label = message.get("speaker")
            if isinstance(label, str) and label:
                self._speaker[turn_id] = label
                self._last_speaker = label
            return None
        if mtype == "speechEnd":
            return None
        if mtype == "speechComplete":
            self._start[turn_id] = int(message.get("startMs", 0))
            self._end[turn_id] = int(message.get("endMs", 0))
            if "lang" in message:
                self._lang[turn_id] = normalize_lang(message.get("lang"))
            return self._complete(turn_id)
        return None

    def _complete(self, turn_id: str) -> dict[str, Any] | None:
        if turn_id in self._done:
            return None
        self._done.add(turn_id)
        speaker = self._speaker.get(turn_id) or self._last_speaker or "A"
        turn = {
            "turn_id": turn_id,
            "speaker": speaker,
            "text": self._text.get(turn_id, ""),
            "lang": self._lang.get(turn_id, "mixed"),
            "start_offset_ms": self._start.get(turn_id, 0),
            "end_offset_ms": self._end.get(turn_id, 0),
            "relative": True,
        }
        for store in (self._text, self._speaker, self._lang, self._start, self._end):
            store.pop(turn_id, None)
        return turn
