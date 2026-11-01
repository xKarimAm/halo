# coach: state

Built 2026-11-02 (plan step 3b). Not live-verified yet.

## File map

| File | Holds |
|---|---|
| `coach.py` | `Coach`: collects `turn.attributed` text per meeting, every 60 s (when 20+ new words) one model call over the meeting so far (newest 3000 words), publishes `coach.tips`; drops a meeting on `meeting.ended` |
| `__init__.py` | exports `Coach`, `TIPS_SCHEMA` |
| `tests/test_coach.py` | tips in viewer language, quiet minute = no call, failed call retries, ended meeting stops, word cap |

Wiring: `halo/app.py` builds and starts it; the Gateway forwards `coach.tips`; the Overlay shows it in the left `.halo-coach` panel.
