# Fact check against past meetings — design

Karim, 2026-11-13. Branch `feat/gemini-provider`.

## Intent

A claim made in a call is checked against what the team said in earlier meetings of the same
project, not only against the web: "we agreed 3 December" when last week's meeting decided
10 December. Karim: "huge value".

## Decided by Karim

- **No new setting.** The web check stays on as today. The past-meetings check switches on by
  itself when the meeting is in a notes-page **Project** (folder) that holds other meetings.
- **The popup's Project field becomes a dropdown of the notes-page Projects.** Picking one at
  Start files the meeting in that Project right away. "No project" means web only.
- **Approach C**, both of:
  - **A. Digest.** The Project's earlier meetings' summaries, decisions, actions and points go
    to the existing reference-notes check. A verdict shows only if it quotes a line that really
    is in them.
  - **B. Per-claim search.** The Project's transcript lines that share the most words with the
    claim are added to the same notes block. It runs locally with no extra model call, so it
    costs nothing extra (Karim: searching per claim with a model "makes no sense").

## Approaches considered

| | What | Trade-off |
|---|---|---|
| A | Project digest as reference notes | Reuses the notes check and its exact-quote rule. Capped at about 12k characters, so roughly the last 5–10 meetings' decisions and points fit; transcripts do not |
| B | Per-claim search of the Project | Reaches transcripts and long projects. In the "Ask" design it needs a keyword model call per claim; here it is local word overlap |
| **C** | **A + B (picked)** | Best coverage. B is local, so a claim still costs one model call |

## Design

1. **Contracts** (contract-change, Karim's sign-off):
   - `meeting.context.project_id` now holds a notes-page Project (folder) id. It is still a
     string and still optional, so the schema shape does not change; only the description does.
   - `claim.checked` gains optional `notes_from: {meeting_id, subject, date, speaker}`: where an
     earlier-meeting quote came from. Absent for the viewer's own notes and for web checks.
2. **Notes Service** (owns `folders.json` and the stored passages). On `meeting.context` with a
   `project_id` that names a Project:
   - file the meeting in that Project;
   - write `data/references/<meeting_id>.past.json` from the Project's other meetings, newest
     first: `{"project": name, "lines": [...digest...], "transcript": [...]}`. Each line is
     `{text, meeting_id, subject, date, speaker, kind}`.
   - With no Project, or none of its other meetings, any old `.past.json` is removed.
3. **Fact Check** (reads files under `data/references`, as it does for the viewer's notes):
   - The notes block is the viewer's notes, then the transcript lines that best match the claim
     (word overlap, top 8), then digest lines, until NOTES_MAX.
   - Each past line is shown as `- Omar (Launch sync, 2026-11-05, decision): <text>`.
   - The model's `notes_quote` is matched back to a stored line. The card shows the stored text
     and `notes_from`, never the model's wording. A quote that matches nothing is dropped, as
     today.
4. **Popup.** The Project field becomes a `<select>`: "No project" plus `GET /api/folders`.
   An old free-text value, or an unreachable backend, falls back to "No project".
5. **Overlay and notes page.** A past-meeting quote reads `Omar · Launch sync · 2026-11-05:
   "…"`; the viewer's own notes still read `Your notes: "…"`.

## Non-goals

- No new model and no embeddings.
- No check across Projects.
- No re-filing of meetings that were moved on the notes page mid-call.

## Left to the builder

- Digest priority within the cap: summary and decisions first, then actions, then points.
- How many transcript lines B adds: 8, marked ponytail.
