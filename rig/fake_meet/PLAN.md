# rig/fake_meet: PLAN

## Job
Wave 1 (W3, Oct 31, lands by Oct 31 night). Lean test rig, L3: the Fake Meet page + the Playwright harness. Purple test tooling — never shipped. The page copies Meet's DOM anchors (`data-participant-id`, name spans, self tile, speaking-highlight toggles), plays fixture video or CC0 photo faces via canvas MediaStreams (`object-fit: cover` at mismatched aspect ratios), serves Meet's CSP + Trusted Types headers. Modes: video | canvas-only (no `<video>`, forces Frame mode). Scripted layouts, join/leave, screen share. Grows from `rig/fake_meet/seed-fixture.html` (the day-0 probe page).

## Inputs (contracts consumed)
Synthetic fixture (`rig/replayer` owns the format: tiles, roles, `t0_ms`, painted face ground truth). The real extension under test (loaded unpacked).

## Outputs (contracts emitted)
A browsable fake meeting the content scripts can attach to; painted ground truth (tile rects, face boxes) the harness asserts against. No contracts emitted — this module fakes the platform, not a Halo peer.

## Lane (the files it owns)
`rig/fake_meet/**`: page + fixtures glue, `package.json`, Playwright tests (`npm --prefix rig/fake_meet test`, Chromium new headless mode — it loads extensions), `test:joined` script for the Nov 1 thin milestone run. Harness responsibilities (diagram): overlay DOM ±4 px vs ground truth, Face Detector IoU on CC0 faces, `?halo_test=1` hub hook, screenshot diffs, capture of the envelopes + binary the extension sends.

## Depends on
`contracts` (to mimic what the adapter reads), fixture format from `rig/replayer`. Blocks: Wave 3 extension gates and the thin milestone.

## Fakes it tests with
It is the fake. Its own correctness is checked by the harness asserting the painted truth it was scripted with (self-check spec below).

## Done = tests
Run: `npm --prefix rig/fake_meet test`. Concrete cases (diagram box + ladder L3): (1) harness loads the unpacked extension, opens the page, the adapter reads every scripted tile (id, name, self tile) — proves the DOM-anchor contract. (2) Canvas-only mode yields no `<video>`; content scripts still attach (Frame mode path). (3) Speaking toggles flip the highlight on schedule; scripted join/leave adds/removes tiles. (4) Painted CC0 faces carry ground-truth boxes the detector spec (IoU ≥ 0.7) consumes. (5) Page serves CSP + Trusted Types headers (response-header assert), so `innerHTML`-style DOM building fails here the way it fails on Meet. (6) `test:joined` exists and drives the thin milestone (real extension + Fake Meet; backend run separately with `HALO_FAKES=1`).

## Cut line
Never cut while any extension work remains — L3 is a blocking CI gate from the day its first test lands. Screenshot diffs are the first sub-feature to make non-blocking if they flake (DOM ±4 px asserts stay blocking).

## Doubts
Answered: Playwright lives here, not in `replayer` (batch 2). Answered (review): screenshot diffs are advisory (uploaded as artifacts) for the hackathon; positional/DOM asserts are the blocking signal.
