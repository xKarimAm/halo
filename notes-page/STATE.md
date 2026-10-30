# notes-page: STATE

Goal: Implement notes-page per its PLAN.md; done ONLY when `npm --prefix notes-page test` passes (render against the golden page JSON).

## Key decisions

- Static shell (`index.html` + `styles.css` + `app.js`, vanilla JS, no build step) built from `docs/ui/notes-v2.html` palette 2 (Sage & Clay, People First). DOM via `textContent`/safe highlight only.
- `app.js` has zero globals: `createApp({ root, fetchJson, postTag, page })` renders list/meeting views; production boot reads `?meeting=` + fetches `/api/*`. All HTTP seams injected for tests.
- Golden-faithful behavior only: `question` → "Open question"; `is_action` points render as suggested actions (the documented live-fallback rule); `turn_ids[0]` links point → transcript line + `recording_offset_ms`; re-tag POSTs `{target, target_id, kind|urgency}` and flips to "by you"; optional `degraded` banner tolerated when present.
- Gaps vs the golden JSON become issues, never mock shapes: (a) page JSON has no action owner/status, no `degraded`, no person relevant-points → `module:contracts`; (b) list/search response shapes undefined → `module:notes_service`.
- Test runner: PLAN says one Playwright render. Attempt Playwright first (chromium headless shell); if the sandbox blocks the browser download, fall back to Vitest + happy-dom and record the deviation.

## Task graph

1. [x] Worktree `.tmp/wt-notes-page` on branch `module/notes-page` from origin/main.
2. [ ] Study `notes-v2.html` palette-2 tokens + People-First skeleton.
3. [ ] `index.html` + `styles.css` + `app.js` (+ `exportMd` builder).
4. [ ] Render tests vs golden JSON (all 7 PLAN cases) + file the two issues.
5. [ ] `npm --prefix notes-page test` green; commit; push; PR.

## File map

- `notes-page/STATE.md`, `notes-page/PLAN.md`, `notes-page/index.html`, `notes-page/styles.css`, `notes-page/app.js`, `notes-page/*.test.*`, `notes-page/package.json`.
- Oracles (read-only): `contracts/golden/page.json`, `contracts/meeting-page.schema.json`, `docs/ui/notes-v2.html`.

## Current step

Tasks 2-4 done: 7/7 Playwright render tests green in real chromium (headless shell) at real repo depth. Issues filed: #14 (contracts page-JSON gaps, contract-change), #15 (notes_service list/search shapes). Next: commit, push, open PR.

## Open questions

- (contracts, to file) Page JSON gaps: `degraded`, action owner/status (assigned vs suggested), per-person relevant points.
- (notes_service, to file) `GET /api/meetings` + `GET /api/search` response shapes.
