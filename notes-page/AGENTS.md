# notes-page/

The post-meeting Notes page: static HTML + CSS + vanilla JS with no build step, served by `backend/halo/notes_service` and fed by `GET /api/meetings/{id}`. One lane, labelled `module:notes-page`.

## Files

- `app.js`: all logic (about 950 lines). `createApp({ root, fetchJson, postTag, page })` is the seam tests drive. Find a function with a search inside this file, then read that line range.
- `index.html`, `styles.css`: the shell, built from `docs/ui/notes-v2.html?palette=2` (the design source of truth).
- `tests/*.spec.js`: Playwright render tests; `tests/fixtures/service-page.json` plus the golden `contracts/golden/page.json` are the inputs.
- `STATE.md`: decisions and open gaps; `PLAN.md`: the spec.

## Tests

- `npm --prefix notes-page test` (what CI runs)
- First run on a new machine: `cd notes-page && npx playwright install --only-shell chromium`

`test-results/` is Playwright output (git-ignored).
