# Submission write-up (draft for the portal)

Karim: this is a draft to adapt. Every claim below is checked against the code on `local/live-fixes`. Lines marked **[check]** need you to confirm them before you submit.

## One line

Halo is a bilingual Arabic/English meeting copilot for Google Meet. While people talk, it shows each point, question, decision and pushback on the speaker's tile, coaches you live, and hands you notes with owners when the call ends. It runs on your PC on Meta models.

## What it does

- **Live bubbles.** A glass bubble appears on the speaker's tile a few seconds after they say something that matters. It shows the kind (point, question, decision, pushback), the urgency, and the exact words one click away. Arabic, English and mixed speech all work, and you read the points in the language you choose.
- **Live coach.** A side panel whispers 0 to 3 tips: a decision with no owner, a question nobody answered, someone who hasn't spoken, a claim nobody checked. A short alert appears when you should act now ("You cut Hana off; hand it back."). Alone in a call, it coaches a rehearsal instead.
- **Notes when the call ends.** You get an AI title and summary, an action items board (Urgent, Medium, Later) with owners and a one-click email, decisions, open questions, pushbacks, a person-by-person view, a chat-style transcript with jumps into the recording, and Markdown export.
- **A private speaking panel.** It shows your talk share, cut-ins, questions, pace and hedged commitments quoted back to you, with no score and no mood words.

## Which Meta models, and where

| Model | Use |
|---|---|
| Muse Voice Transcribe 1.0 (realtime) | Two sessions per meeting: the call in diarization mode, your mic in endpointing mode. Arabic + English. |
| Muse Spark 1.3 (contributor) | Every text call: live points, the urgency/kind re-check every 10 s, the live coach, and the end-of-meeting notes. Each call returns schema-checked JSON. |
| Muse Spark Open (open weights) | Wired as the first choice when a Baseten, Modal or local key is set, with per-call failover to Spark 1.3. **[check]**: say whether it ran in your final setup. |
| SAM 3.1 (open weights, local GPU) | Optional Halo mode: finds the speaker's face so the name sits above their head. **[check]**: say whether it was verified on a live call. |

No other AI model runs in Halo. Claude Code and Muse Code / OpenCode (on Spark 1.3) were coding tools only, and Gemini was used for research only.

## How it works

1. A Chrome extension captures the call audio and your mic, and reads Meet's page for tiles, names and who is highlighted as speaking.
2. Both go over one local WebSocket to a FastAPI backend on `127.0.0.1`. Every message is a typed envelope, validated and acknowledged.
3. Muse Voice turns the audio into turns. A correlator matches each turn to the right person on screen.
4. Spark reads the attributed turns and returns points. A second pass re-checks urgency. The coach reads the meeting so far.
5. When the meeting ends, Spark writes the notes in one schema-checked call. Everything is stored in local SQLite and served as the notes page.

Architecture: `docs/ARCHITECTURE.md`.

## What was hard

- **Who said it.** Meet's speaking highlight trails the audio. The correlator uses a lag window, locks a speaker after 3 agreeing turns, and drops echo from your own mic.
- **Speed.** A point has to land while it is still relevant. Points trigger at the speaker's pause rather than at the end of the sentence, the model replies are short, and a slow call fails over per call. Points typically land 3 to 5 s after the words. **[check]**: confirm this on your live run.
- **A coach that knows when to stay quiet.** I tuned it in blind-judged loops on 10 scripted meetings, English and Arabic. One model wrote the tips and a separate judge scored old against new without knowing which was which. The last round cut invented owners and dates from 4 to 1 and dropped median latency from 5.1 s to 4.6 s.
- **Bilingual speech.** Mixed Arabic/English sentences flow through the whole pipeline. The notes page and the overlay render each quote in its own script direction.

## Reproduce it

See "Judging in 5 minutes" in the README:

1. Install with a Meta key.
2. Run `uv run python packaging/demo.py` for three full meetings without a call.
3. Run `uv run halo` and open `http://127.0.0.1:8765`.

The tests (`uv run pytest`, `npm --prefix extension test`) need no keys.

## What's next

- **Ask across meetings:** questions like "what did we decide about pricing?", answered with quotes from past meetings.
- **Halo mode on every tile**, not only the speaker's.
- **Carry-over:** open items from the last meeting with the same people show up at the next Start.
