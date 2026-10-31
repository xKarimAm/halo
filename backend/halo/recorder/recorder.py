"""Recorder: binary rec chunks in, webm files + ts index out.

Consumes the gateway's `(seq, ts_ms, webm)` tuples from the bounded rec queue
(header already stripped by `gateway/audio.py`) and the bus lifecycle
(`meeting.started` opens a meeting, `meeting.ended` finalizes it exactly
once). One webm file per meeting per recording-on period under
`recordings/`: the first covering file is exactly
`recordings/{meeting_id}.webm` (the #37 convention shared with notes_builder
and notes_service); a ts gap over `GAP_SPLIT_MS` starts `{meeting_id}.2.webm`
and so on. A sidecar `{meeting_id}.index.json` lists the covering files with
per-chunk `[ts_ms, offset]` entries; the notes service reads it for
point → recording-moment links. No bus events, no health slot.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import struct
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

log = logging.getLogger("halo.recorder")

Envelope = dict[str, Any]
# A ts jump bigger than this starts a new covering file (switch off/on).
GAP_SPLIT_MS = 30_000
# Staging cap before overflow spills to temp (memory protection).
DEFAULT_STAGING_CAP = 8 * 1024 * 1024
_SPILL_RECORD = struct.Struct("<QQI")  # seq, ts_ms, len(payload)


@dataclass
class _File:
    path: Path
    rel: str
    start_ts_ms: int
    last_ts_ms: int = 0
    seen_seq: int = -1
    size: int = 0
    entries: list[list[int]] = field(default_factory=list)
    handle: Any = None


@dataclass
class _Meeting:
    meeting_id: str
    t0_ms: int = 0
    finalized: bool = False
    files: list[_File] = field(default_factory=list)
    staged: list[tuple[int, int, bytes]] = field(default_factory=list)
    staged_bytes: int = 0


class Recorder:
    """Owns the recording files. Constructed by app.py; see STATE.md."""

    def __init__(
        self,
        bus: Any,
        *,
        data_dir: Path | str | None = None,
        rec_queue: asyncio.Queue | None = None,
        max_staging_bytes: int = DEFAULT_STAGING_CAP,
        file_opener: Callable[[Path, str], Any] | None = None,
    ) -> None:
        self._bus = bus
        self._data_dir = Path(data_dir) if data_dir is not None else Path(
            os.environ.get("HALO_DATA_DIR") or "data")
        self._recordings = self._data_dir / "recordings"
        self._queue = rec_queue if rec_queue is not None else asyncio.Queue()
        self._cap = max_staging_bytes
        self._open = file_opener or open
        self._meetings: dict[str, _Meeting] = {}
        self._order: list[str] = []  # started order; latest live wins chunks
        self._task: asyncio.Task | None = None
        bus.subscribe("meeting.started", self._on_started)
        bus.subscribe("meeting.ended", self._on_ended)

    # -- bus -----------------------------------------------------------------

    def _meeting_id(self, envelope: Envelope) -> str | None:
        mid = envelope.get("meetingid") or envelope.get("data", {}).get("meeting_id")
        return mid if isinstance(mid, str) and mid else None

    def _on_started(self, envelope: Envelope) -> None:
        mid = self._meeting_id(envelope)
        if mid is None:
            return
        data = envelope.get("data", {})
        t0 = data.get("t0_ms", 0) if isinstance(data, dict) else 0
        meeting = self._meetings.get(mid)
        if meeting is None:
            self._meetings[mid] = _Meeting(meeting_id=mid, t0_ms=t0 or 0)
            self._order.append(mid)
        elif meeting.finalized:
            meeting.finalized = False  # new recording period, same id
            log.info("recorder: %s re-started, new covering files follow", mid)
        # An already-live meeting keeps its first t0.

    def _on_ended(self, envelope: Envelope) -> None:
        mid = self._meeting_id(envelope)
        if mid is None:
            return
        meeting = self._meetings.get(mid)
        if meeting is None or meeting.finalized:
            log.info("recorder: ignore meeting.ended for %s (unknown/finalized)", mid)
            return
        self.finalize(mid)

    # -- ingest ---------------------------------------------------------------

    def _live(self) -> _Meeting | None:
        for mid in reversed(self._order):
            meeting = self._meetings[mid]
            if not meeting.finalized:
                return meeting
        return None

    def ingest(self, item: Any) -> None:
        """Stage one `(seq, ts_ms, webm)` tuple for the live meeting."""
        if (not isinstance(item, tuple) or len(item) != 3
                or not isinstance(item[0], int) or not isinstance(item[1], int)
                or not isinstance(item[2], bytes)):
            log.warning("recorder: drop malformed rec item %r", type(item))
            return
        seq, ts_ms, payload = item
        meeting = self._live()
        if meeting is None:
            log.warning("recorder: drop chunk seq=%d (no live meeting)", seq)
            return
        current = meeting.files[-1] if meeting.files else None
        if current is not None and current.handle is None and meeting.finalized:
            log.warning("recorder: drop chunk seq=%d (meeting ended)", seq)
            return
        if current is not None and ts_ms - current.last_ts_ms > GAP_SPLIT_MS:
            self._split(meeting)
            current = None
        if current is None:
            current = self._open_file(meeting, ts_ms)
        if seq <= current.seen_seq:
            log.warning("recorder: drop chunk seq=%d (duplicate/out of order)", seq)
            return
        if ts_ms < current.start_ts_ms:
            log.warning("recorder: drop chunk seq=%d (older than covering file)", seq)
            return
        current.seen_seq = seq
        current.last_ts_ms = max(current.last_ts_ms, ts_ms)
        meeting.staged.append((seq, ts_ms, payload))
        meeting.staged_bytes += len(payload)
        if meeting.staged_bytes > self._cap:
            self._spill(meeting, current)

    def _recordings_dir(self) -> Path:
        self._recordings.mkdir(parents=True, exist_ok=True)
        return self._recordings

    def _open_file(self, meeting: _Meeting, ts_ms: int) -> _File:
        n = len(meeting.files)
        name = (f"{meeting.meeting_id}.webm" if n == 0
                else f"{meeting.meeting_id}.{n + 1}.webm")
        path = self._recordings_dir() / name
        current = _File(path=path, rel=f"recordings/{name}",
                        start_ts_ms=ts_ms, last_ts_ms=ts_ms)
        meeting.files.append(current)
        return current

    def _split(self, meeting: _Meeting) -> None:
        self._flush_meeting(meeting)
        current = meeting.files[-1]
        if current.handle is not None:
            current.handle.close()
            current.handle = None
        log.info("recorder: %s gap split, new covering file follows", meeting.meeting_id)

    def _spill(self, meeting: _Meeting, current: _File) -> None:
        """Move the oldest staged entries to temp, newest stay in memory."""
        spill = current.path.with_suffix(".spill")
        try:
            with self._open(spill, "ab") as fh:
                while meeting.staged and meeting.staged_bytes > self._cap:
                    seq, ts_ms, payload = meeting.staged.pop(0)
                    fh.write(_SPILL_RECORD.pack(seq, ts_ms, len(payload)) + payload)
                    meeting.staged_bytes -= len(payload)
        except OSError:
            log.exception("recorder: spill failed for %s", meeting.meeting_id)

    def _read_spill(self, current: _File) -> list[tuple[int, int, bytes]]:
        spill = current.path.with_suffix(".spill")
        if not spill.exists():
            return []
        entries: list[tuple[int, int, bytes]] = []
        try:
            with self._open(spill, "rb") as fh:
                while True:
                    head = fh.read(_SPILL_RECORD.size)
                    if not head:
                        break
                    if len(head) < _SPILL_RECORD.size:
                        raise OSError("short spill record")
                    seq, ts_ms, size = _SPILL_RECORD.unpack(head)
                    payload = fh.read(size)
                    if len(payload) < size:
                        raise OSError("short spill payload")
                    entries.append((seq, ts_ms, payload))
        except OSError:
            log.exception("recorder: unreadable spill %s", spill)
            return []
        return entries

    # -- flush / finalize ------------------------------------------------------

    def flush_all(self) -> None:
        for mid in list(self._order):
            self._flush_meeting(self._meetings[mid])

    def _flush_meeting(self, meeting: _Meeting) -> None:
        if not meeting.files and not meeting.staged:
            return
        current = meeting.files[-1] if meeting.files else None
        if current is None:
            return
        spilled = self._read_spill(current)
        entries = [(ts, payload) for _, ts, payload in spilled]
        entries.extend((ts, payload) for _, ts, payload in meeting.staged)
        if not entries:
            self._write_sidecar(meeting)
            return
        try:
            size_before = current.path.stat().st_size if current.path.exists() else 0
            if current.handle is None:
                current.handle = self._open(current.path, "ab")
            for ts_ms, payload in entries:
                current.entries.append([ts_ms, current.size])
                current.handle.write(payload)
                current.size += len(payload)
            current.handle.flush()
        except OSError:
            log.exception("recorder: write failed for %s, retry later", current.rel)
            try:
                if current.handle is not None:
                    current.handle.close()
                with self._open(current.path, "r+b") as fh:
                    fh.truncate(size_before)
                current.handle = None
            except OSError:
                log.exception("recorder: truncate failed for %s", current.rel)
            self._park_unwritten(meeting, current, spilled, size_before)
            return
        spill = current.path.with_suffix(".spill")
        try:
            spill.unlink(missing_ok=True)
        except OSError:
            log.exception("recorder: cannot remove spill %s", spill)
        meeting.staged.clear()
        meeting.staged_bytes = 0
        self._write_sidecar(meeting)

    def _park_unwritten(
            self, meeting: _Meeting, current: _File,
            spilled: list[tuple[int, int, bytes]], size_before: int) -> None:
        """A failed flush keeps every byte: spill holds all of it again."""
        current.entries = [e for e in current.entries if e[1] < size_before]
        current.size = size_before
        entries = list(spilled) + list(meeting.staged)
        meeting.staged.clear()
        meeting.staged_bytes = 0
        try:
            spill = current.path.with_suffix(".spill")
            with self._open(spill, "wb") as fh:
                for seq, ts_ms, payload in entries:
                    fh.write(_SPILL_RECORD.pack(seq, ts_ms, len(payload)) + payload)
        except OSError:
            log.exception("recorder: re-spill failed for %s", meeting.meeting_id)
            meeting.staged = entries
            meeting.staged_bytes = sum(len(p) for _, _, p in entries)

    def finalize(self, meeting_id: str) -> None:
        meeting = self._meetings.get(meeting_id)
        if meeting is None or meeting.finalized:
            return
        self._flush_meeting(meeting)
        for current in meeting.files:
            if current.handle is not None:
                try:
                    current.handle.close()
                except OSError:
                    log.exception("recorder: close failed for %s", current.rel)
                current.handle = None
        meeting.finalized = True
        self._write_sidecar(meeting)

    def _write_sidecar(self, meeting: _Meeting) -> None:
        if not meeting.files:
            return
        sidecar = {
            "meeting_id": meeting.meeting_id, "t0_ms": meeting.t0_ms,
            "files": [{"path": f.rel, "start_ts_ms": f.start_ts_ms,
                       "chunks": [list(e) for e in f.entries]} for f in meeting.files],
        }
        try:
            path = self._recordings_dir() / f"{meeting.meeting_id}.index.json"
            with self._open(path, "w") as fh:
                fh.write(json.dumps(sidecar))
        except OSError:
            log.exception("recorder: sidecar failed for %s", meeting.meeting_id)

    # -- reads -----------------------------------------------------------------

    def covering_file(self, meeting_id: str, ts_ms: int) -> tuple[str, int] | None:
        """`(path, ts_ms - file start)` of the file covering `ts_ms`, if any."""
        path = self._recordings / f"{meeting_id}.index.json"
        try:
            sidecar = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        cover = None
        for entry in sidecar.get("files", []):
            if ts_ms >= entry["start_ts_ms"]:
                cover = entry
        if cover is None:
            return None
        return cover["path"], ts_ms - cover["start_ts_ms"]

    # -- background loop ---------------------------------------------------------

    def start(self) -> None:
        self._task = asyncio.get_running_loop().create_task(self._drain_loop())

    def stop(self) -> None:
        try:
            self.flush_all()
        except OSError:
            log.exception("recorder: final flush failed")
        if self._task is not None:
            self._task.cancel()
            self._task = None

    async def _drain_loop(self) -> None:
        assert self._queue is not None
        while True:
            try:
                item = await asyncio.wait_for(self._queue.get(), timeout=0.25)
            except TimeoutError:
                self.flush_all()
                continue
            self.ingest(item)
            if self._staged_bytes() >= self._cap:
                self.flush_all()

    def _staged_bytes(self) -> int:
        return sum(m.staged_bytes for m in self._meetings.values())

