# coach: state

Built 2026-11-02 (plan step 3b). Not live-verified yet.

## File map

| File | Holds |
|---|---|
| `coach.py` | `Coach`: collects `turn.attributed` text per meeting; a 1 s loop calls the model on new words (at most once per 8 s) or after 15 s of silence (once per quiet stretch), over the newest 2000 words, with the viewer's name and Setup role; publishes `coach.tips` (0-3 tips + optional alert) unless the reply is empty; drops a meeting on `meeting.ended` |
| `__init__.py` | exports `Coach`, `TIPS_SCHEMA` |
| `tests/test_coach.py` | tips in viewer language, quiet minute = no call, failed call retries, ended meeting stops, word cap |

Wiring: `halo/app.py` builds and starts it; the Gateway forwards `coach.tips`; the Overlay shows it in the left `.halo-coach` panel.
