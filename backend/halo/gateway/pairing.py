"""Pairing backend: single-use 6-digit codes, restart-persistent tokens.

The current code lives in memory only: each backend start mints a fresh one,
so a spent code stays spent across restarts by construction. Issued tokens
survive restarts as sha256 hashes in `<data_dir>/pairing.json` (never
plaintext). `HALO_DATA_DIR` selects the data dir; the default is `./data`.
"""

from __future__ import annotations

import hashlib
import json
import secrets
from pathlib import Path

STORE_FILE = "pairing.json"


def _mint_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _mint_token() -> str:
    return secrets.token_urlsafe(32)


class PairingStore:
    def __init__(self, data_dir: Path | str) -> None:
        self._dir = Path(data_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._file = self._dir / STORE_FILE
        self._hashes: set[str] = set(self._read())
        self._code = _mint_code()
        self._spent = False

    @property
    def current_code(self) -> str:
        return self._code

    @property
    def store_file(self) -> Path:
        return self._file

    def redeem(self, code: object) -> str | None:
        """Trade the current single-use code for a token, or None."""
        if not isinstance(code, str) or len(code) != 6 or not code.isdigit():
            return None
        if self._spent or code != self._code:
            return None
        self._spent = True
        token = _mint_token()
        self._hashes.add(_hash(token))
        self._write()
        return token

    def check(self, token: object) -> bool:
        """True when `token` was issued by this backend (any boot)."""
        if not isinstance(token, str) or not token:
            return False
        return _hash(token) in self._hashes

    def _read(self) -> list[str]:
        try:
            raw = self._file.read_text(encoding="utf-8")
        except OSError:
            return []
        try:
            data = json.loads(raw)
        except ValueError:
            return []
        hashes = data.get("token_hashes") if isinstance(data, dict) else None
        return [h for h in hashes] if isinstance(hashes, list) and all(isinstance(h, str) for h in hashes) else []

    def _write(self) -> None:
        self._file.write_text(json.dumps({"token_hashes": sorted(self._hashes)}), encoding="utf-8")
