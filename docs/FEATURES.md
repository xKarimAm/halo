# Features

Everything Halo does today, and how far each piece has been checked.

| Status | Meaning |
|---|---|
| **Live** | Seen working on a real Google Meet call, or on the notes of one |
| **Tested** | Covered by automated tests and the demo run (`packaging/demo.py`), not yet seen on a live call |
| **Optional** | Built, and needs extra hardware or a key you may not have |

How to use each one: [user guide](USER-GUIDE.md). A per-commit log is in [demo/feature-log.md](demo/feature-log.md).

## In the Meet call

| Feature | What it does | Status |
|---|---|---|
| Speech bubbles | A glass bubble appears on the speaker's tile a few seconds after they say something that matters: a point, a question, a decision or a pushback. Colour is urgency (red urgent, amber medium, blue later) and the glyph is the kind (• ? ✓ ≠). | Live |
| Bilingual speech | Arabic, English and mixed sentences all go through. Each quote shows in its own script direction. | Tested (the demo run plays an Arabic and a mixed meeting) |
| Points language | You read the points in English or Arabic, whatever language was spoken. Switch it mid-call from the Halo menu. | Tested |
| The exact words | Click a bubble to see the kind, the speaker, the point and the exact words said. | Tested |
| Urgent items stay | Urgent points stay until you archive them; others fade after 60 s. | Tested |
| More than 3 points | `+N` opens the rest of a tile's points, **Less** folds them. | Live |
| Live caption | The speaker's last ~12 words appear above their bubbles about 0.3 s after Voice hears them. Captions are never saved. | Live |
| Halo menu | One pill at the top centre: points language and the colour/glyph legend. | Tested |
| Hide everything | Alt+H hides or shows all bubbles. | Tested |
| Notes toast | "Meeting notes are ready" with a link when the meeting ends. | Tested |
| Live coach | A side panel with 0 to 3 tips on steering the meeting (a decision with no owner, an unanswered question, someone who hasn't spoken) and a short alert when you should act now. Alone in a call, it coaches a rehearsal. Tuned in blind-judged loops on 10 scripted meetings. | Tested |
| Faster points | Points start at the speaker's pause, not the end of the sentence. | Tested |
| Halo mode | The name floats above the speaker's head and the bubbles sit beside the face, from SAM 3.1 on your own GPU. | Optional (NVIDIA GPU), tested |

## Toolbar popup

| Feature | What it does | Status |
|---|---|---|
| Three steps | Pair, About this meeting, Start; each folds to one line when done. | Live |
| Meeting context | Subject, agenda and people's roles sharpen the points, the owners and the coach. | Tested |
| One Start | A repeat Start does nothing; a new Start replaces the old capture instead of stacking a second. | Tested |
| Mic name | After Start, the popup names the microphone Halo opened. | Live |
| Consent notice | Copies a bilingual notice to paste into the Meet chat. Halo never posts to the chat itself. | Tested |

## Notes page (http://127.0.0.1:8765)

| Feature | What it does | Status |
|---|---|---|
| AI title and summary | Written by Spark when the meeting ends, in the meeting's language. | Live |
| Action items board | Urgent, Medium and Later columns, each item with its owner. Re-tag any item and your tag wins over the model's. | Live |
| Email an action | Opens a ready email with the item, owner and meeting. | Tested |
| Points, questions, decisions, pushbacks | Filter chips with counts; each item links to its transcript line. | Live |
| Disagreements | Each side's view, the outcome and how it was resolved. | Tested |
| People | Click a person for their role, their points and the actions they own. | Live |
| Your speaking (private) | Talk share against an even share, longest stretch, questions, cut-ins, pace, hedged commitments quoted, one thing to try next call. No score, no mood words. | Live |
| Transcript and recording | A chat-style transcript. Each item's play button jumps to that moment in the recording (call audio and your mic). | Live (recordings saved on live calls) |
| Ask your meetings | Ask in English or Arabic; get a short answer in the same language and the exact stored lines it came from. Click one to open that meeting at that line. If the notes don't say, it says so. | Tested, plus checked by hand on the demo meetings |
| Meetings list | Cards with who spoke, length and counts; hover to preview; folders; search. | Live |
| Export Markdown | The whole meeting as Markdown, ready to paste into an AI. | Live |
| English / Arabic | The whole page switches language, Arabic right to left. | Live |
| Back and Forward | Every view has its own address. | Live |

## Behind the scenes

| Feature | What it does | Status |
|---|---|---|
| Two transcripts kept apart | The call (diarized, who is talking) and your mic ("you") are separate Voice sessions. | Live |
| Who said it | Matches each turn to the right tile using Meet's speaking highlight, with a lag window because the highlight trails the audio. | Live |
| Failover | With a Spark Open key, a slow or failing call moves to Spark 1.3 contributor, per call. | Tested |
| Health file | `data/health.json` every 5 s, with problems in plain words ("no mic audio for 60 s"). | Live |
| Everything local | SQLite database, recordings and logs stay in `data/`. | Live |

## Not built yet

| Idea | Why not yet |
|---|---|
| Halo mode on every tile, not only the speaker's | One SAM call per frame on one GPU; every tile multiplies the cost. Next after the hackathon. |
| Carry-over: open items from the last meeting with the same people at the next Start | Needs people matched across meetings; the data is stored, the matching isn't written. |
| Video clips of each moment | The recording is audio only by design (smaller, and nobody's face is stored). |
