# Submission write-up (draft for the portal)

Karim: this is a draft to adapt. Every claim below is checked against the code on `local/submit-polish`. Lines marked **[check]** need you to confirm them before you submit. Updated 5 Nov 00:20 with the 4 Nov features; ready-to-paste portal answers are at the end.

## One line

Halo is a bilingual Arabic/English meeting copilot for Google Meet. While people talk, it shows each point, question, decision and pushback on the speaker's tile, coaches you live, and hands you notes with owners when the call ends. It runs on your PC on Meta models.

## What it does

- **Live bubbles.** A glass bubble appears on the speaker's tile a few seconds after they say something that matters. It shows the kind (point, question, decision, pushback), the urgency, and the exact words one click away. Arabic, English and mixed speech all work, and you read the points in the language you choose.
- **Live coach.** A side panel whispers 0 to 3 tips: a decision with no owner, a question nobody answered, someone who hasn't spoken, a claim nobody checked. A short alert appears when you should act now ("You cut Hana off; hand it back."). Alone in a call, it coaches a rehearsal instead.
- **Live fact check.** When someone states a public number, Muse Spark's web search checks it while the call runs. A card shows the verdict and a source a few seconds later; internal numbers are skipped without a search. Each check also lands in the notes.
- **Notes when the call ends.** You get an AI title and summary, an action items board (Urgent, Medium, Later) with owners and a one-click email, decisions, open questions, pushbacks, a person-by-person view, a chat-style transcript with jumps into the recording, and Markdown export.
- **A visual recap.** One press draws the meeting as a one-page sketch with Muse Image, with the decisions and next steps in the meeting's own words, Arabic included.
- **Ask your meetings.** Questions like "who owns the signup numbers?" get a short answer in the question's language (Arabic or English), with the exact stored lines it came from. A click opens the meeting at that moment. An Arabic question finds an English meeting and the other way round. If the notes don't say, it says so.
- **Your own notes as a reference.** Add a Markdown or text file before the call and the live fact check also tests what people say against your notes, quoting the line that settled it. Add it after the call and Spark compares the two: what agrees, what differs, what needs a follow-up.
- **Close the loop on actions.** Mark an urgent or open action Done with a short note of what was done; it leaves the lists and the note stays on the meeting.
- **Projects, Archive and Deleted.** Meetings group into projects; Deleted keeps a meeting for 30 days.
- **Arabic everywhere.** The whole app switches to Arabic in one tap, Arabic text always sits on the right, and the visual recap is drawn in the meeting's own language.
- **Zoom and Teams on the web,** as well as Google Meet.
- **You choose what shows on the call.** Name pills, points, the coach and fact checks each switch on or off from the Halo badge.
- **Induction and Welcome.** A first-run Welcome page opens once after install and starts a guided tour of every feature (what it is, why, how); the tour can be replayed from the Induction button.
- **A private speaking panel.** It shows your talk share, cut-ins, questions, pace and hedged commitments quoted back to you, with no score and no mood words.

## Which Meta models, and where

| Model | Use |
|---|---|
| Muse Voice Transcribe 1.0 (realtime) | Two sessions per meeting: the call in diarization mode, your mic in endpointing mode. Arabic + English. |
| Muse Spark 1.3 (contributor) | Every text call: live points, the urgency/kind re-check every 10 s, the live coach, the end-of-meeting notes, the recap's mind map in the meeting's language, the comparison with your reference notes, and Ask your meetings (keyword expansion in English + Arabic, then a cited answer). Each call returns schema-checked JSON. |
| Muse Spark web search | Live fact check. A spoken claim goes to Spark with the `web_search` tool; the links shown are the URLs the search returned, never text the model wrote. |
| Muse Image 1.0 | The visual recap on the notes page, drawn only on request. |
| Muse Spark Open (open weights) | First choice for live points when a Baseten, Modal or local key is set, with per-call failover to Spark 1.3. Verified in the stored data: it made 69 live points between 3 and 4 Nov; every point records the engine that made it. |
| SAM 3.1 (open weights, local GPU) | Optional Halo mode: finds the speaker's face so the name sits above their head. Ran on Karim's live calls (the local worker log shows the extension's frame requests, last on 4 Nov). |

No other AI model runs in Halo. Claude Code and Muse Code / OpenCode (on Spark 1.3) were coding tools only, and Gemini was used for research only.

## How it works

1. A Chrome extension captures the call audio and your mic, and reads Meet's page for tiles, names and who is highlighted as speaking.
2. Both go over one local WebSocket to a FastAPI backend on `127.0.0.1`. Every message is a typed envelope, validated and acknowledged.
3. Muse Voice turns the audio into turns. A correlator matches each turn to the right person on screen.
4. Spark reads the attributed turns and returns points. A second pass re-checks urgency. The coach reads the meeting so far.
5. When the meeting ends, Spark writes the notes in one schema-checked call. Everything is stored in local SQLite and served as the notes page.

Architecture: `docs/ARCHITECTURE.md`.

## Why this needs Meta's models

Halo is built around things these models do together, not a generic chat endpoint behind a meeting tool:

- **Two Muse Voice sessions per meeting:** the call in diarization mode and your mic in endpointing mode, with Arabic and English in one sentence.
- **Muse Spark search grounding, live:** a spoken number is checked on the web and answered with a source during the call. The same model skips internal claims without searching.
- **SAM 3.1 on open weights:** the name sits above the speaker's head, following Meta's own "multi-speaker headlocked captions" recipe.
- **Muse Spark Open first, Spark 1.3 as per-call failover,** with every point recording which engine made it.
- **Muse Image:** the meeting as a picture, in the meeting's own words and language.

## What was hard

- **Who said it.** Meet's speaking highlight trails the audio. The correlator uses a lag window, locks a speaker after 3 agreeing turns, and drops echo from your own mic. Stored calls also showed audio capture running about 3% short of real time, which put turn stamps 19 s behind Meet's speaking edges after 10 minutes; stamps now follow the wall clock.
- **Speed.** A point has to land while it is still relevant. Points trigger at the speaker's pause rather than at the end of the sentence, the model replies are short, and a slow call fails over per call. On Karim's live calls of 1-3 Nov the model step took 3.3 to 4.7 s at the median, so a point typically lands about 5 s after the words. **[check]**: replace with the number from your final live run.
- **A coach that knows when to stay quiet.** I tuned it in blind-judged loops on 10 scripted meetings, English and Arabic. Spark wrote the tips and a separate Claude agent (a development tool, never part of Halo) scored old against new without knowing which was which. The last round cut invented owners and dates from 4 to 1 and dropped median latency from 5.1 s to 4.6 s.
- **Bilingual speech.** Mixed Arabic/English sentences flow through the whole pipeline. The notes page and the overlay render each quote in its own script direction.

## Reproduce it

See "Judging in 5 minutes" in the README:

1. Install with a Meta key.
2. Run `uv run python packaging/demo.py` for three full meetings without a call.
3. Run `uv run halo` and open `http://127.0.0.1:8765`.

The tests (`uv run pytest`, `npm --prefix extension test`) need no keys.

## What's next

- **Halo mode on every tile**, not only the speaker's.
- **Carry-over:** open items from the last meeting with the same people show up at the next Start.

## Portal answers (ready to paste)

**Track:** Indie Developer Track. **Problem statement:** Build for Your World.

**Project Description**

Halo is a bilingual Arabic/English meeting copilot for Google Meet (and Zoom and Teams on the web). While people talk, it shows each point, question, decision and pushback next to the person who said it, coaches you live, and checks spoken numbers on the web, with a source, during the call. When the call ends you get a meeting page: an AI summary, actions grouped by urgency with owners, decisions, open questions, a transcript that jumps into the recording, a visual recap drawn in the meeting's own language, and a comparison with your own notes. You can ask questions across all your meetings in Arabic or English and get answers that cite the exact lines. It runs on your PC with one setup script and your Meta key; every AI model it calls is a Meta model.

**Describe your use of Meta products to build the submitted project**

Runtime, all through the Meta Model API or Meta open weights:
- Muse Voice Transcribe 1.0 (realtime): two sessions per meeting, the call in diarization mode and your mic in endpointing mode, with Arabic and English language bias and the participants' names as keywords.
- Muse Spark 1.3: every text step, with schema-checked JSON: live points, an urgency re-check every 10 s, the live coach, the end-of-meeting notes, the mind-map text for the recap, the comparison with your reference notes, and Ask your meetings.
- Muse Spark web search: live fact checks with the URLs the search returned.
- Muse Image 1.0: the one-page visual recap, drawn only on request.
- Muse Spark Open (open weights, via Baseten): first engine for live points, with per-call failover to Spark 1.3; it made 69 of the live points in our test meetings.
- SAM 3.1 (open weights, local GPU): optional Halo mode that places the speaker's name above their head.
Build: Muse Code / OpenCode on Spark 1.3 as a coding agent, alongside Claude Code.

**Why are Meta's models important to your solution?**

Halo depends on what these models do together in real time. Muse Voice handles Arabic and English inside the same sentence, in two sessions at once, which is how people in the Gulf actually talk in meetings. Spark returns schema-checked JSON fast enough that a point lands about 5 s after the words, and its built-in web search lets Halo check a spoken number with a real source while the call is still running. Spark Open gives an open-weights first engine with failover to Spark 1.3 on every call, so a slow call never blocks the meeting. Muse Image turns the meeting into a picture in its own language, Arabic included, and SAM 3.1 makes the name follow the speaker. Without one family covering speech, text, search, images and vision, Halo would be five vendors stitched together.

**Partner technologies feedback** (optional) **[check]**: Karim, say which partner you used (Baseten for Spark Open?) and one line on how it went.
