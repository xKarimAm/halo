# classifier: PLAN

## Job
Wave 4 (W1, Nov 2). Ring 2 — first ring-2 cut. Off the critical path: never delays a point. Live only: every 10 s, if new points arrived, one batched call to the contributor model (via `llm`) confirming or correcting Insight's first-guess `urgency` + `kind`; the Overlay updates the bubble in place. No end-of-meeting pass (DECISIONS §5 wins over the old diagram label). Action items are never tagged here — the Notes Builder tags its own actions, so there is no race with `notes.ready`. This module emits `tags.set` for points only.

## Inputs (contracts consumed)
Bus: `points.upsert` (new points to classify), `tags.set` (to learn user-tagged targets: any target with a `source: user` tag is skipped forever).

## Outputs (contracts emitted)
`tags.set {target: "point", target_id, kind?, urgency?, source: "model", model}` on the Bus when the batch changes a kind or urgency. (`target: "action"` rows exist but come only from a user re-tag via `POST /api/tags` — never from this module.) Health callable for `system.status` (`tagger: ok|down`).

## Lane (the files it owns)
`backend/halo/classifier/**` (+ `tests/`).

## Depends on
`contracts`, `bus`, `llm`, Insight's `points.upsert` stream.

## Fakes it tests with
FakeLLM canned tags; schema check on every emitted `tags.set`.

## Done = tests
Run: `uv run pytest backend/halo/classifier -q`. Concrete cases (diagram box: FakeLLM canned tags; schema check): (1) new points within a 10 s window produce exactly one batched call; no new points → no call. (2) A canned correction emits `tags.set` with the new `kind`/`urgency`, `source: model`. (3) Points whose guess is confirmed emit nothing. (4) After any `tags.set` with `source: user` for a target, later batches never emit for that target again. (5) The module still emits nothing at `meeting.ended` (live only). (6) Emitted JSON validates against the `tags.set` schema; a failing health callable flips `tagger` to `down` in `system.status` without affecting live points.

## Cut line
Ring 2, first to cut inside ring 2 (DECISIONS §6/§8). Cutting it leaves Insight's first-guess tags live; user re-tag and the Notes Builder's action tags still work.

## Doubts
Answered: live-only, skip-forever, merge rule lives in Event Store `tags_effective` (batches 4). Answered (review): the batch window is a fixed 10 s tick from module start (not per-point debounce); points arriving just after a tick wait for the next one.
