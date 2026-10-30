# notes-page: PLAN

## Job
Wave 4 (W2; starts as soon as `setup_panel`, `meet_adapter`, `frame_source` merge — likely Nov 1 — against the golden page JSON; ring 2). Static front-end: HTML + CSS + vanilla JS, no build step, built from `docs/ui/notes-v2.html?palette=2` (People First layout, Sage & Clay). Served by the Notes Service router; `GET /notes/{meeting_id}` returns this same shell for every meeting and the shell fetches JSON. Meetings list + search; meeting page with clickable avatars; per person: why they matter (role), relevant points, own points, action items grouped Urgent / Medium / Later (`assigned` said aloud vs `suggested` by role). Every point links to its transcript line and recording moment. Markdown export. One-click re-tag (“by Halo / by you” menu → `POST /api/tags`). `degraded: true` shows “AI summary failed, showing live notes”.

## Inputs (contracts consumed)
`GET /api/meetings/{meeting_id}` page JSON (meeting + people + points + actions with merged tags + transcript lines + recording offsets) — built first against the golden JSON in `contracts`. `GET /api/meetings?project_id=`, `GET /api/search?q=`. Kind labels: `question` displays as “Open question” (one vocabulary everywhere).

## Outputs (contracts emitted)
`POST /api/tags {target, target_id, kind?, urgency?}` (field names identical to `tags.set`). No envelopes; the page never holds keys and never opens the socket. Recording seek uses the offsets in the page JSON (transcript line → covering recording file position from the Notes Service).

## Lane (the files it owns)
`notes-page/**` (shell `index.html`, CSS, vanilla JS, render test). Served, not built: the Notes Service router mounts these files.

## Depends on
Golden page JSON (`contracts`), then Notes Service endpoints. Ring 2 — not on the critical path; the demo's live bubbles never wait for this page.

## Fakes it tests with
Golden page JSON fixture (the same one W1 tests Notes Service snapshots against).

## Done = tests
Run: `npm --prefix notes-page test` (one Playwright render against the golden JSON). Concrete cases: (1) list view renders meetings + search box; a query renders hits with `<mark>` highlights. (2) Meeting view: avatar row selects a person; panel shows `why`, relevant points, own points, actions; category filter counts match the fixture. (3) Action board groups Urgent / Medium / Later with `assigned` solid vs `suggested` dashed. (4) Point click jumps to the transcript line and the recording position from the JSON offset. (5) Re-tag click posts `{target, target_id, kind}` (or `urgency`) and the item re-renders as “by you”. (6) `degraded: true` fixture shows the “AI summary failed” line and still renders live points + actions. (7) Arabic toggle renders RTL with Arabic kind/urgency labels; no horizontal overflow at 560 px.

## Cut line
✂5 re-tag menu (this page's menu only; stored tags keep working). ✂4 shows up here as the degraded/live-points rendering, which is built anyway. ✂6 Arabic polish beyond RTL correctness.

## Doubts
Answered: shell + JSON split, golden-JSON-first build (batches 2–3). Answered (review): the golden page JSON in `contracts` wins, not the mock. A field this page needs that the JSON lacks becomes a `module:contracts` issue with the `contract-change` label — never a mock-shaped workaround here, and not a Notes Service change.
