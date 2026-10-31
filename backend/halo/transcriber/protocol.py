"""Muse Voice Transcribe realtime protocol helpers (pure, no I/O).

Handshake goes in the first JSON frame (the HTTP Authorization header is
ignored on this endpoint). Turns are keyed by str(turnId): the engine sends
int ids (0, 1, ...) while the old fake sent uuid strings; both work.

Real wire shapes (day-0 arabic-asr probe, results-karim.json):
- {"type": "speechStart", "turnId": 0, "audioProcessedMs": N}
- {"type": "transcript", "transcript": <cumulative>, "final": false, ...}
  with NO turnId: attaches to the open turn from the last speechStart.
  A closing {"transcript": "", "final": true} ends the session (ignored).
- {"type": "speaker", "label": "A", ...} with NO turnId, arriving only at
  the END of the turn.
- {"type": "speechEnd", "turnId": 0, "audioProcessedMs": N}
- {"type": "speechComplete", "turnId": 0, "transcript": <full text>, ...}
  (no startMs/endMs/lang; offsets come from the speechStart/speechEnd
  audioProcessedMs).

The old fake shapes ("partial" with turnId/text, "speaker" with
turnId/speaker, speechComplete with startMs/endMs/lang/text) stay accepted
until the fake is updated.

Because Voice closes a turn only on a speaker change, a long monologue is
one wire turn. The session soft-cuts open turns at PCM pauses: maybe_cut()
emits the new words since the last cut (fresh turn_id downstream), holding
back the last SOFT_CUT_TAIL_WORDS because Voice rewrites the frontier;
speechComplete then emits only the uncut remainder, so text is never
duplicated or lost (whitespace-normalised prefix match).
"""

from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger("halo.transcriber")

DIARIZATION = "DIARIZATION"
ENDPOINTING = "ENDPOINTING"

LANGUAGE_BIAS = ["arabic", "english"]

SOFT_CUT_TAIL_WORDS = 3


def build_handshake(mode: str, key: str, keywords: list[str] | None = None) -> dict[str, Any]:
    """First JSON frame: Bearer [REDACTED] + fixed session mode + ASR hints."""
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


def _ms(value: Any) -> int | None:
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


class TurnAssembler:
    """Assembles final turns from the turn lifecycle, keyed by str(turnId).

    Partials are cumulative (each replaces the last); a `speaker` event
    labels the span before it; speechComplete (or `final: true` on the old
    fake's `partial`) completes. Completed turns carry offsets relative to
    session audio; the session maps them onto the meeting clock with its
    anchor. maybe_cut() emits pause pieces with the same shape.
    """

    def __init__(self) -> None:
        self._text: dict[str, str] = {}
        self._speaker: dict[str, str | None] = {}
        self._lang: dict[str, str] = {}
        self._start: dict[str, int] = {}
        self._end: dict[str, int] = {}
        self._latest: dict[str, int] = {}
        self._emitted: dict[str, str] = {}
        self._cut_end: dict[str, int] = {}
        self._open: str | None = None
        self._done: set[str] = set()

    @staticmethod
    def _key_of(message: dict[str, Any]) -> str | None:
        turn_id = message.get("turnId")
        if turn_id is None or turn_id == "":
            return None
        return str(turn_id)

    def _ensure(self, key: str) -> None:
        self._text.setdefault(key, "")
        self._speaker.setdefault(key, None)
        self._emitted.setdefault(key, "")
        if key not in self._start:
            self._start[key] = 0
        if key not in self._cut_end:
            self._cut_end[key] = self._start[key]

    def handle(self, message: dict[str, Any]) -> dict[str, Any] | None:
        """Feed one server message; returns the completed turn or None."""
        mtype = message.get("type")
        if mtype == "speechStart":
            key = self._key_of(message)
            if key is None:
                return None
            self._ensure(key)
            self._text[key] = ""
            self._speaker[key] = None
            self._lang.pop(key, None)
            self._emitted[key] = ""
            self._done.discard(key)
            start = _ms(message.get("audioProcessedMs"))
            if start is not None:
                self._start[key] = start
                self._cut_end[key] = start
            self._open = key
            return None
        if mtype == "transcript":
            text = message.get("transcript")
            if not isinstance(text, str):
                return None
            key = self._key_of(message) or self._open
            if key is None or key in self._done:
                return None
            self._ensure(key)
            if message.get("final") is True:
                if not text.strip():
                    return None  # session-close marker, not a turn
                # A non-empty final only refreshes the cumulative text;
                # speechComplete still completes (it carries the offsets).
                self._text[key] = text
                latest = _ms(message.get("audioProcessedMs"))
                if latest is not None:
                    self._latest[key] = latest
                return None
            self._text[key] = text
            latest = _ms(message.get("audioProcessedMs"))
            if latest is not None:
                self._latest[key] = latest
            return None
        if mtype == "partial":
            key = self._key_of(message)
            if key is None or key in self._done:
                return None
            self._ensure(key)
            if isinstance(message.get("text"), str):
                self._text[key] = message["text"]
            if message.get("final") is True:
                return self._complete(key)
            return None
        if mtype == "speaker":
            label = message.get("label")
            if not isinstance(label, str) or not label:
                label = message.get("speaker")  # old fake shape
            if not isinstance(label, str) or not label:
                return None
            key = self._key_of(message) or self._open
            if key is None or key in self._done:
                return None
            self._ensure(key)
            self._speaker[key] = label
            return None
        if mtype == "speechEnd":
            key = self._key_of(message)
            if key is None:
                return None
            self._ensure(key)
            end = _ms(message.get("audioProcessedMs"))
            if end is not None:
                self._end[key] = end
            return None
        if mtype == "speechComplete":
            key = self._key_of(message)
            if key is None:
                return None
            self._ensure(key)
            text = message.get("transcript")
            if not isinstance(text, str):
                text = message.get("text")  # old fake shape
            if isinstance(text, str) and text:
                self._text[key] = text
            if "startMs" in message:  # old fake shape
                self._start[key] = int(message.get("startMs", 0))
            if "endMs" in message:  # old fake shape
                self._end[key] = int(message.get("endMs", 0))
            end = _ms(message.get("audioProcessedMs"))
            if end is not None and "endMs" not in message:
                self._end[key] = end
            if "lang" in message:
                self._lang[key] = normalize_lang(message.get("lang"))
            return self._complete(key)
        return None

    def maybe_cut(self) -> dict[str, Any] | None:
        """Emit the open turn's new words since the last cut, or None.

        The session calls this once a pause has lasted long enough. Cuts at
        a word boundary and holds back the last SOFT_CUT_TAIL_WORDS: Voice
        rewrites the frontier, and the final remainder carries any tail fix.
        """
        key = self._open
        if key is None or key in self._done:
            return None
        turn_words = self._text.get(key, "").split()
        cut_words = self._emitted.get(key, "").split()
        if len(turn_words) <= len(cut_words):
            return None
        if turn_words[: len(cut_words)] != cut_words:
            return None  # frontier rewrite touched cut text; wait for the fix
        extra = turn_words[len(cut_words):]
        if len(extra) <= SOFT_CUT_TAIL_WORDS:
            return None
        new_words = extra[: -SOFT_CUT_TAIL_WORDS]
        start = self._cut_end.get(key, self._start.get(key, 0))
        end = self._latest.get(key, start)
        self._emitted[key] = " ".join(cut_words + new_words)
        self._cut_end[key] = end
        return {
            "turn_id": key,
            "speaker": self._speaker.get(key) or "?",
            "text": " ".join(new_words),
            "lang": self._lang.get(key, "mixed"),
            "start_offset_ms": start,
            "end_offset_ms": end,
            "relative": True,
        }

    def _complete(self, turn_id: str) -> dict[str, Any] | None:
        if turn_id in self._done:
            return None
        self._done.add(turn_id)
        full_words = self._text.get(turn_id, "").split()
        cut_words = self._emitted.get(turn_id, "").split()
        if full_words[: len(cut_words)] == cut_words:
            rest = full_words[len(cut_words):]
        else:
            # A rewrite touched already-cut words: fall back to the common
            # word prefix so the remainder never duplicates cut text.
            shared = 0
            while (
                shared < min(len(cut_words), len(full_words))
                and cut_words[shared] == full_words[shared]
            ):
                shared += 1
            log.warning("transcriber turn rewritten after soft-cut: turn=%s", turn_id)
            rest = full_words[shared:]
        start = self._cut_end.get(turn_id, self._start.get(turn_id, 0))
        end = self._end.get(turn_id, self._latest.get(turn_id, start))
        speaker = self._speaker.get(turn_id) or "?"
        lang = self._lang.get(turn_id, "mixed")
        if turn_id == self._open:
            self._open = None
        for store in (self._text, self._speaker, self._lang, self._start,
                      self._end, self._latest, self._emitted, self._cut_end):
            store.pop(turn_id, None)
        if not rest:
            return None
        return {
            "turn_id": turn_id,
            "speaker": speaker,
            "text": " ".join(rest),
            "lang": lang,
            "start_offset_ms": start,
            "end_offset_ms": end,
            "relative": True,
        }
