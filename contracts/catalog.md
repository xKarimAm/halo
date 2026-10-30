# Halo contract catalog

One JSON Schema per type. Each `<type>.schema.json` validates the envelope `data` object; `envelope.schema.json` validates the CloudEvents 1.0 wrapper. Validate both with `contracts/validate.py` (`validate_envelope`, `validate_ack`).

ACK lives on the extension ⇄ Gateway socket only. Inside the backend, `bus.publish()` returns a typed Ack at once. ACK error codes (closed): `invalid_schema | unknown_type | unpaired | internal`. A duplicate envelope `id` gets ACK `ok` again and is not re-published.

`meetingid` is required on every envelope except `pair.*`, `system.status` and `llm.health` (global, null allowed). Envelope `time` is server wall clock, for logs only; meeting time is integer ms on the browser clock.

| Type | Schema | Emitter | Consumers |
|---|---|---|---|
| `pair.hello` | `pair.hello.schema.json` | Hub (hub_capture), first message on every connect | Gateway (reply is its ACK) |
| `pair.ok` | `pair.ok.schema.json` | Gateway | Hub |
| `pair.rejected` | `pair.rejected.schema.json` | Gateway | Hub (Setup Panel shows re-pair) |
| `meeting.started` | `meeting.started.schema.json` | Hub at Start click | Correlator, Event Store, Notes Builder (via Gateway → Bus) |
| `meeting.ended` | `meeting.ended.schema.json` | Hub (left/tab_closed); Gateway backstop (timeout, 60 s) | Transcriber, Notes Builder, Recorder — once per meeting, first wins |
| `system.status` | `system.status.schema.json` | Gateway (from `bus.health()`, 5 s and on change) | Overlay |
| `meeting.context` | `meeting.context.schema.json` | Setup Panel via hub; re-sent by hub on `set_viewer_lang` | Insight, Event Store |
| `tiles.snapshot` | `tiles.snapshot.schema.json` | Meet Adapter | Overlay + Frame Source in-tab; Correlator + Event Store via hub/socket |
| `speaker.active` | `speaker.active.schema.json` | Meet Adapter | Overlay in-tab; Correlator + Event Store via hub/socket |
| `transcript.final` | `transcript.final.schema.json` | Transcriber | Correlator, Event Store |
| `turn.attributed` | `turn.attributed.schema.json` | Correlator | Insight, Event Store |
| `speaker.mapped` | `speaker.mapped.schema.json` | Correlator | Insight, Overlay (via Gateway), Event Store |
| `points.upsert` | `points.upsert.schema.json` | Insight | Classifier, Overlay (via Gateway), Event Store |
| `llm.health` | `llm.health.schema.json` | Insight (engine change, else ≤30 s) | Gateway, Event Store |
| `tags.set` | `tags.set.schema.json` | Classifier (model); Notes Service on POST /api/tags (user) | Overlay (via Gateway), Event Store, Classifier (skip set) |
| `notes.ready` | `notes.ready.schema.json` | Notes Builder | Event Store, Overlay toast (via Gateway) |
| envelope | `envelope.schema.json` | every envelope sender | every receiver |
| ACK | `ack.schema.json` | Gateway (socket); `bus.publish()` return value | Hub; backend publishers |
| `faces.update` (in-tab) | `faces.update.schema.json` | Face Detector | Overlay |
| `TileFrame` (in-tab) | `tileframe.schema.json` (JSON fields only; ImageBitmap never serialises) | Frame Source | Face Detector |
| meeting page JSON (HTTP) | `meeting-page.schema.json` | Notes Service (`GET /api/meetings/{meeting_id}`) | Notes page |

Pinned domains: kind `point|question|decision|pushback`; urgency `urgent|medium|later`; `viewer_lang` `en|ar`; turn `lang` `ar|en|mixed`; `attribution` `provisional|locked`; `rank` integer 1–3; ids are UUID strings. Fields flagged “inferred, Karim to confirm” in PLAN.md keep these domains.

## Binary framing (data plane, `contracts/binary.py`)

Little-endian. No envelope, no ACK, no id. `kind=2` is reserved and rejected.

| Kind | Layout | Emitter → consumer |
|---|---|---|
| 1 (audio) | `[kind u8][stream u8: 0=tab, 1=mic][seq u32][ts_ms u64]` + PCM16 mono 16 kHz, 100 ms frames | Hub Capture → Gateway → Transcriber queues |
| 3 (rec) | `[kind u8][seq u32][ts_ms u64]` + webm bytes | Hub Capture → Gateway → Recorder queue |

## HTTP (JSON, no envelope, 127.0.0.1:8765)

Gateway owns `/ws`, `GET/POST /pair`, Host/Origin middleware. Notes Service owns `GET /notes/{meeting_id}` (same shell for every meeting), `GET /api/meetings/{meeting_id}` (shape: `meeting-page.schema.json`, sample: `golden/page.json`), `GET /api/meetings?project_id=`, `GET /api/search?q=`, `GET /api/meetings/{id}/export.md`, `POST /api/tags` (field names identical to `tags.set`).
