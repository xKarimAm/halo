# Halo feature log (for the demo and slides)

Every feature and small detail, newest first. Karim asked for this on 2026-11-02 so the demo and slides show the small things too. Commits are on branch `local/live-fixes` (not pushed yet).

## In the Meet call (overlay)

| Feature | What you see | Since |
|---|---|---|
| Live caption | The speaker's last ~12 words appear above their bubbles about 0.3 s after Voice hears them, word by word; they clear when the turn ends. Your own words go on your tile, other people's on the tile Meet marks as speaking. Never saved (the final transcript is). | a081392, live-checked 2026-11-02 |
| Halo menu | One Halo pill at the top centre. A click opens the points language and the colour/glyph legend; a click outside closes it. | 7dfe8b0, b6f0e09 |
| Expand `+N` | When a tile has more than 3 points, `+2` opens them all; "Less" folds them back. | 7dfe8b0, live-checked |
| Glass look | Lighter, slightly luminous glass with a thin light edge (iPhone-like, not milky) on bubbles, name pill, caption and Halo pill. | 7dfe8b0 |
| Colour = urgency | Red urgent, amber medium, blue later, as a tab on each bubble; kind is a glyph (• point, ? question, ✓ decision, ≠ pushback). | 2026-11-01 |
| Urgent stays | Urgent points stay on screen until you click them and press Archive; others fade after 60 s. | 2026-11-01 |
| Original quote | Click a bubble: kind, speaker, the point and the exact words said, in their own script direction (Arabic right-to-left). | earlier |
| Meeting coach | A left-side panel with 1-3 tips on steering the meeting (a decision with no owner, a question nobody answered, someone who has not spoken), from the model reading the whole meeting so far, about once a minute. x hides it until the next tips. | f4c5985 (not yet live-checked) |
| Faster points | Points start the moment the speaker pauses (no waiting for 8 words or a full stop) with a shorter model reply: about 1.5-2 s sooner per point. One-word transcript scraps ("Can" / "anyone hear") are gone: a pause cut needs 3 words. | e95e150 (not yet live-checked) |
| Points language | Switch points between English and Arabic mid-meeting from the Halo menu. | earlier |
| Alt+H | Hides or shows all bubbles; the pill says "Halo · hidden". | earlier |
| Notes toast | "Meeting notes are ready" with a link when the meeting ends. | earlier |

## Toolbar popup

| Feature | What you see | Since |
|---|---|---|
| Consent notice | "Copy consent notice" under Start puts a bilingual (English/Arabic) notice on the clipboard to paste into Meet chat. Nothing posts to chat automatically. | 7dfe8b0 |
| Mic name | After Start the popup names the mic Halo opened (e.g. "Microphone: Arctis Nova Pro Wireless"). | f428cf9 |
| Three steps | Pair, About this meeting, Start, each folding to one line when done. | earlier |

## Notes page (after the meeting)

| Feature | What you see | Since |
|---|---|---|
| Back works | Every view has its own address, so the browser Back and Forward buttons move between the list and a meeting. | bd83b39 |
| Hover preview | Hover a meeting in the list: its AI title, summary, Urgent/Medium/Later counts, top action items and decisions show on the right (Wispr-Flow style). | bd83b39 |
| Folders | "Create folder" from the preview, move meetings between folders, filter the list by folder. | bd83b39 |
| AI title + summary | At meeting end Spark writes a title (8 words max) and a 3-5 sentence summary, in the meeting's language. | f9b52a2 |
| Email an action | Each assigned action item has an Email link that opens a ready message with the item, owner and meeting. | bd83b39 |
| Look | Sage & Clay from the locked design, all headers in Inter (no serif, Karim 2026-11-02); neat punctuation: every shown item starts with a capital and ends with a period, titles end with none. | 78a7146, 196d50c |
| Action items board | Urgent / Medium / Later columns; "by Halo" lets you re-tag any item and Halo keeps your choice over the model's. | earlier, liked by Karim 2026-11-02 |
| Points, questions, decisions, pushbacks | Filter chips with counts; each item links to its transcript line. | earlier |
| Recording + play buttons | Each item's play button jumps to that moment in the meeting recording (tab + your mic mixed). | f572d24 (built, not yet live-checked) |
| Export Markdown | One click exports the whole meeting as Markdown to hand to an AI. | earlier, liked by Karim |
| English / Arabic | The whole page switches language (Arabic right-to-left). | earlier |

| Meeting cards (landing) | Each card: everyone who spoke, length, and counts of decisions, open questions, pushbacks and urgent actions; the preview opens on the newest meeting. | 86469c6, f4e2867 |
| Calmer meeting page | Date, length, people on one line; panels in balanced columns; transcript reads like a chat (one name per run); tools appear on hover; each fact said once. | 86469c6, a4f4de7 |
| Your speaking | Private panel: talk share vs an even share, longest stretch, questions and follow-ups, cut-ins, pace, hedged commitments quoted, one thing to try next call. No score, no mood words. | f4e2867 |

## Backend (behind the scenes)

- Two transcription streams kept apart: the call (diarized) and your mic ("you"); Arabic, English and mixed speech.
- Points come from Meta's Spark model; the urgency classifier re-checks them every 10 s.
- Everything stays on this PC: SQLite database, recordings, logs. Health file every 5 s with live problems ("no mic audio for 60 s", wrong or silent mic).

- Coach (2026-11-03): tuned in blind-judged loops on 10 scripted meetings; quiet once an item is settled, rehearsal mode when alone, tips name what was just said, alerts say who, no alert twice. | 7c060e6

## Ideas Karim raised (not built)

- Video clips: cut the moment of each point from the screen recording, not just the audio.
- RAG / vector search across meetings (advised later, with carry-over in step 5).
