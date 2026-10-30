# notes_builder: PLAN

## Job
Wave 4 (W1, Nov 2). Ring 2. On `meeting.ended` (once per `meeting_id`; first emitter wins — hub or Gateway timeout — later ones ignored): full log + roles + live points into the notes template via the contributor model (via `llm`, schema enforced). Per person: why they matter, relevant points, own points, action items with owner, `assigned|suggested`, and urgency — tagged here, no separate pass, so no race with `notes.ready`. Fallback on model failure: still emit `notes.ready` with `degraded: true`, actions from live points marked `is_action` (`status: suggested`, urgency from the `tags_effective` merge rule), `why` empty; the Notes page shows “AI summary failed, showing live notes”.

## Inputs (contracts consumed)
Bus trigger: `meeting.ended`. Read-only SQLite (Event Store contract): full event log for the meeting, `points_current`, `tags_effective`, `transcript.final` lines, `meeting.context` roles. Emits nothing else; Notes Service does not consume this event — it reads the stored result.

## Outputs (contracts emitted)
`notes.ready {meeting_id, project_id?, url: "/notes/{meeting_id}", degraded: bool, people: [{name, role, why, relevant_points[], own_points[], actions: [{action_id, text, owner, status: assigned|suggested, urgency: urgent|medium|later}]}]}` on the Bus → stored by the Event Store tap, forwarded by the Gateway to the Overlay (toast). `degraded` flagged “inferred, Karim to confirm” in contracts.

## Lane (the files it owns)
`backend/halo/notes_builder/**` (+ `tests/`, notes prompt template).

## Depends on
`contracts`, `bus`, `llm`, Event Store schema + views. Trigger chain: `meeting.ended` → this module → `notes.ready` (see master plan coverage table).

## Fakes it tests with
FakeLLM canned notes (valid + invalid-JSON variants); a replay-seeded DB from `rig/replayer`.

## Done = tests
Run: `uv run pytest backend/halo/notes_builder -q`. Concrete cases (diagram box: FakeLLM canned notes; validates `notes.ready`): (1) seeded meeting → `notes.ready` validates, each person carries role/`why`/relevant/own points, every action has owner + `assigned|suggested` + urgency. (2) A second `meeting.ended` for the same `meeting_id` emits nothing. (3) FakeLLM invalid JSON twice (after `llm` retry/failover) → still exactly one `notes.ready` with `degraded: true`, actions from `is_action` live points, `why` empty. (4) Points another point `replaces` never appear; `tags_effective` urgency wins over Insight's guess in fallback actions. (5) `url` is `/notes/{meeting_id}` and `project_id` passes through from context when present.

## Cut line
✂4 per-person depth (keep live points + action list) — the degraded shape above is exactly that fallback, so the cut is a config of this module, not a rewrite (DECISIONS §8).

## Doubts
Answered: degraded fallback + `degraded: bool` inferred flag (batch 4). Answered (review): the “full log” sent to the model is the meeting's `transcript.final` lines + `points_current` + roles, truncated from the oldest transcript lines if it exceeds the model's context; actions/points are never truncated.
