"""WebSocket transport to Muse Voice Transcribe realtime."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from typing import Any

import websockets

from halo.transcriber.session import EngineTransport, TransportError

log = logging.getLogger("halo.transcriber")


class WsTransport(EngineTransport):
    """One WS connection. Handshake is the first JSON frame (never a header)."""

    def __init__(self, url: str) -> None:
        self.url = url
        self._ws: Any = None

    async def open(self, handshake: dict[str, Any]) -> None:
        try:
            self._ws = await websockets.connect(self.url, max_size=1 << 20)
            await self._ws.send(json.dumps(handshake))
        except Exception as exc:
            raise TransportError(f"voice connect failed: {exc!r}") from exc

    async def send_audio(self, pcm: bytes, ts_ms: int = 0) -> None:
        if self._ws is None:
            raise TransportError("voice session not open")
        try:
            await self._ws.send(pcm)
        except Exception as exc:
            raise TransportError(f"voice send failed: {exc!r}") from exc

    async def recv_event(self) -> dict[str, Any] | None:
        if self._ws is None:
            return None
        try:
            message = await asyncio.wait_for(self._ws.recv(), timeout=0.05)
        except TimeoutError:
            return None
        except Exception as exc:
            raise TransportError(f"voice recv failed: {exc!r}") from exc
        if isinstance(message, bytes):
            return None
        try:
            parsed = json.loads(message)
        except ValueError:
            return None
        return parsed if isinstance(parsed, dict) else None

    async def close(self) -> None:
        ws, self._ws = self._ws, None
        if ws is None:
            return
        try:
            await ws.close()
        except Exception:
            log.exception("voice close failed")


GEMINI_URL = ("wss://generativelanguage.googleapis.com/ws/"
              "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent")
GEMINI_STT_MODEL = "models/gemini-3.5-transcribe-live"


def gemini_setup(keywords: list[str]) -> dict[str, Any]:
    # Empty languageCodes = auto-detect: the probe showed ar-EG+en-US no better on mixed speech.
    # Gemini's own end of speech at 600 ms pauses splits monologues (probe 2026-11-13); the
    # session's soft-cut cannot, since Gemini's final re-transcribes and would not match
    # the cut interims (live check: duplicated text).
    return {"setup": {"model": GEMINI_STT_MODEL,
                      "generationConfig": {"responseModalities": ["TEXT"]},
                      "realtimeInputConfig": {"automaticActivityDetection": {
                          "endOfSpeechSensitivity": "END_SENSITIVITY_HIGH", "silenceDurationMs": 600}},
                      "inputAudioTranscription": {"languageCodes": [], "customVocabulary": list(keywords)}}}


def _offset_ms(raw: Any) -> int | None:
    try:
        return round(float(str(raw).rstrip("s")) * 1000)
    except ValueError:
        return None


class GeminiEvents:
    """Gemini Live frames -> Voice-shaped events (protocol.TurnAssembler input).

    voiceActivity START/END carry the session audio offset; interim text is
    cumulative; the final arrives just before or after ACTIVITY_END, so the
    turn completes once both are in. No speaker labels: tab turns stay "?".
    """

    def __init__(self) -> None:
        self._turn = -1
        self._end: int | None = None
        self._final: str | None = None

    def translate(self, msg: dict[str, Any]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        activity = msg.get("voiceActivity") or {}
        content = msg.get("serverContent") or {}
        if activity.get("type") == "ACTIVITY_START":
            self._turn += 1
            self._end, self._final = None, None
            out.append({"type": "speechStart", "turnId": self._turn,
                        "audioProcessedMs": _offset_ms(activity.get("audioOffset"))})
        interim = (content.get("interimInputTranscription") or {}).get("text")
        if isinstance(interim, str) and self._turn >= 0:
            # No audio position on interims, so the session never soft-cuts them (see gemini_setup).
            out.append({"type": "transcript", "transcript": interim, "final": False})
        final = (content.get("inputTranscription") or {}).get("text")
        if isinstance(final, str):
            self._final = final
        if activity.get("type") == "ACTIVITY_END":
            self._end = _offset_ms(activity.get("audioOffset"))
        if self._final is not None and self._end is not None:
            if self._final.strip():
                out.append({"type": "speechComplete", "turnId": self._turn,
                            "transcript": self._final, "audioProcessedMs": self._end})
            self._end, self._final = None, None
        return out


class GeminiTransport(EngineTransport):
    """gemini-3.5-transcribe-live over the Live API WebSocket. The key goes in a
    header, never the URL, so no error or log line can carry it."""

    def __init__(self, url: str = GEMINI_URL) -> None:
        self.url = url
        self._ws: Any = None
        self._events = GeminiEvents()
        self._pending: list[dict[str, Any]] = []

    async def open(self, handshake: dict[str, Any]) -> None:
        key = str(handshake.get("authorization", {}).get("accessToken", "")).removeprefix("Bearer ")
        self._events, self._pending = GeminiEvents(), []
        try:
            self._ws = await websockets.connect(self.url, additional_headers={"x-goog-api-key": key},
                                                max_size=1 << 22)
            await self._ws.send(json.dumps(gemini_setup(list(handshake.get("keywords") or []))))
            # Audio sent before setupComplete can cancel the session (Google docs).
            reply = json.loads(await asyncio.wait_for(self._ws.recv(), timeout=10))
        except Exception as exc:
            raise TransportError(f"gemini connect failed: {exc!r}") from exc
        if "setupComplete" not in reply:
            raise TransportError(f"gemini setup refused: {str(reply)[:200]}")

    async def send_audio(self, pcm: bytes, ts_ms: int = 0) -> None:
        if self._ws is None:
            raise TransportError("gemini session not open")
        try:
            await self._ws.send(json.dumps({"realtimeInput": {"audio": {
                "data": base64.b64encode(pcm).decode(), "mimeType": "audio/pcm;rate=16000"}}}))
        except Exception as exc:
            raise TransportError(f"gemini send failed: {exc!r}") from exc

    async def recv_event(self) -> dict[str, Any] | None:
        while not self._pending:
            if self._ws is None:
                return None
            try:
                message = await asyncio.wait_for(self._ws.recv(), timeout=0.05)
            except TimeoutError:
                return None
            except Exception as exc:
                raise TransportError(f"gemini recv failed: {exc!r}") from exc
            try:
                parsed = json.loads(message)  # Gemini sends JSON as binary frames
            except ValueError:
                continue
            if isinstance(parsed, dict):
                self._pending.extend(self._events.translate(parsed))
        return self._pending.pop(0)

    async def close(self) -> None:
        ws, self._ws = self._ws, None
        if ws is None:
            return
        try:
            await ws.close()
        except Exception:
            log.exception("gemini close failed")
