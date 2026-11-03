# Halo user guide

Halo listens to a Google Meet call on your PC and shows what matters while people talk: a point, a question, a decision or a pushback, as glass bubbles on the speaker's video tile, in English or Arabic. A coach panel whispers how to steer the meeting. When the call ends you get a notes page with action items, owners and the transcript.

Install and first run: [README](../README.md). Problems: [troubleshooting](TROUBLESHOOTING.md).

## Before the call

1. Start the backend (`uv run halo`) and leave its window open.
2. Join the Meet call in Chrome, with a headset on.
3. Click the Halo icon. The popup has three steps, and each folds to one line when done:
   - **Pair**: only the first time. Type the 6-digit code from the backend window.
   - **About this meeting** (optional, but it makes everything sharper):
     - the subject
     - the agenda, one item per line
     - people and roles, for example "Layla, Engineering lead"
     - under **Preferences**, the language for your points
   - **Start**: press it once. It turns to **Running**, and the popup names the microphone Halo opened.
4. Tell everyone Halo is recording. **Copy consent notice** puts a bilingual notice on your clipboard to paste into Meet chat. Halo never posts to the chat itself.

## During the call

| What | How it works |
|---|---|
| Bubbles | A point appears on the speaker's tile a few seconds after they say it. The tab colour is urgency (red urgent, amber medium, blue later). The glyph is the kind: • point, ? question, ✓ decision, ≠ pushback. |
| The original words | Click a bubble to see the kind, the speaker, the point and the exact words said, in their own script (Arabic right to left). |
| Urgent items stay | Urgent points stay until you click them and press **Archive**. Others fade after 60 s. |
| More than 3 points | `+2` opens the rest; **Less** folds them back. |
| Live caption | The speaker's last few words appear above their bubbles while they talk. Captions are not saved; the final transcript is. |
| Coach | A panel on the left with 0 to 3 tips, for example a decision with no owner, a question nobody answered, or someone who hasn't spoken. A short alert appears when you should act now ("You cut Hana off; hand it back."). × hides it until the next tips. Alone in a call, it treats the call as a rehearsal and coaches your delivery. |
| Halo menu | The Halo pill at the top centre switches the points language mid-call and shows the colour and glyph legend. |
| Hide everything | Alt+H hides or shows all bubbles; the pill then says "Halo · hidden". |
| Halo mode | With the optional SAM 3.1 worker running (NVIDIA GPU), the name and bubbles sit above the speaker's head instead of inside the tile. |

The meeting ends when you press **Stop**, leave the call, or close the Meet tab. A "Meeting notes are ready" toast with a link then appears on the Meet page.

## After the call: the notes page

Open http://127.0.0.1:8765 (it goes to the meetings list) or click the toast's link.

- **Meetings list:** each card shows who spoke, the length, and counts of decisions, open questions, pushbacks and urgent actions. Hover a card to preview its AI title, summary and top action items. Use **Create folder** to group meetings, then filter the list by folder.
- **A meeting:**
  - **Action items board:** Urgent, Medium and Later columns. Each item has its owner and an **Email** link that opens a ready message. "by Halo" lets you re-tag an item, and your choice always wins over the model's.
  - **Points, questions, decisions, pushbacks:** filter chips with counts. Each item links to its transcript line and to that moment in the recording.
  - **People:** click a person to see their role, their points and the actions they own.
  - **Your speaking (private):** your talk share against an even share, longest stretch, questions, cut-ins, pace, hedged commitments quoted, and one thing to try next call. There is no score and no mood words.
  - **Transcript:** reads like a chat, one name per run.
  - **Export Markdown:** the whole meeting as Markdown, ready to paste into an AI.
  - **English / Arabic:** the whole page switches language (Arabic right to left).

## Solo use

- **Your own meetings:** run Halo in any call you join. Most of it is aimed at you, the viewer:
  - the coach tips
  - your speaking panel
  - your points language
- **Rehearsal:** start a Meet call alone and present. The coach treats it as a rehearsal: lead with the number, cut filler, keep the stronger version of a line.
- **Bilingual calls:** speakers can mix Arabic and English mid-sentence. You can read the points in the language you prefer.

## Team use

Halo runs on one PC: the person who presses Start. Nothing is hosted, so there is no shared account. Teams use it like this:

- **One note-taker for the room:** the meeting lead runs Halo. After the call they send each owner their action item with the **Email** link, or paste **Export Markdown** into the team's doc or chat.
- **Roles make it sharper:** enter people's roles in **About this meeting**. Points, action owners and the coach use them, for example a product manager gets nudged on success metrics and a sales lead on who signs off.
- **Re-tagging is the team's call:** if Halo marks something urgent that isn't, re-tag it. Your tag sticks across the board and the notes.
- **Each person can run their own copy:** every teammate who wants their own coach and speaking panel runs Halo on their PC. Each copy only knows the meetings it recorded.

## Privacy

- **What leaves your PC:** the call audio goes to Meta's speech-to-text, and the transcript text goes to Meta's text models. That's all.
- **What stays on your PC:** recordings, transcripts and notes stay in the `data` folder. Video frames never leave it either; in Halo mode they go only to the SAM worker on your own GPU.
- **Wiping everything:** delete the `data` folder.
- **Consent:** tell everyone in the call before you press Start.
