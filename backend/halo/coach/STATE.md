# coach: state

Built 2026-11-02 (plan step 3b). Live-checked 2026-11-15 (tips only).

v5 (Karim 2026-11-16): a one-line `read` of what is going on (stage, topic, what is missing, e.g. no opening yet), speech numbers in the prompt (your share of words, longest stretch, questions, filler, minutes and pace from turn times), constructive tips (what you noticed, then what to do, with words to say), and the reply is the whole tip list (empty clears it). Blind eval vs v4 on 12 scenarios x 2 rounds: see the commit. Next steps, bit by bit: a per-meeting delivery summary on the notes page, then interruptions from real turn times.

## File map

| File | Holds |
|---|---|
| `coach.py` | `Coach`: collects `turn.attributed` text per meeting; a 1 s loop calls the model on new words (at most once per 8 s) or after 15 s of silence (once per quiet stretch), over the newest 2000 words, with the viewer's name and Setup role; publishes `coach.tips` (an optional read line, 0-3 tips, optional alert) when what the viewer sees changes; `speech()` builds the speech-numbers line; drops a meeting on `meeting.ended` |
| `__init__.py` | exports `Coach`, `TIPS_SCHEMA` |
| `tests/test_coach.py` | tips in viewer language, quiet minute = no call, failed call retries, ended meeting stops, word cap, read line and whole-list tips, speech numbers, talk share after 80 words, unknown viewer |

Wiring: `halo/app.py` builds and starts it; the Gateway forwards `coach.tips`; the Overlay shows it in the left `.halo-coach` panel.
