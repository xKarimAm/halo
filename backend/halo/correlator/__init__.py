"""Correlator: attach a tile + name to every final turn."""

from halo.correlator.correlator import (
    ECHO_WINDOW_MS,
    HOLD_TIMEOUT_S,
    LAG_MS,
    LOCK_AFTER,
    Correlator,
)

__all__ = [
    "ECHO_WINDOW_MS",
    "HOLD_TIMEOUT_S",
    "LAG_MS",
    "LOCK_AFTER",
    "Correlator",
]
