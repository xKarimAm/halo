# ACK test kit

Fixtures + expected behaviour for the one place ACK can be lost: the
extension ⇄ Gateway socket. Inside the backend there is no socket ACK kit:
`bus.publish()` returns a typed Ack at once.

This kit asserts no hub or Event Store behaviour itself. The runners execute
it inside their own suites:

| Runner | Lane | What it proves with these fixtures |
|---|---|---|
| `gateway` | `backend/halo/gateway/tests/` | valid envelope → ACK `ok`, one Bus publish; duplicate `id` → ACK `ok`, still one publish; envelope before `pair.ok` → ACK `error/unpaired`; bad schema → `invalid_schema`; unknown type → `unknown_type` |
| `hub_capture` | `extension/src/hub_capture/` | dropped ACK → the same envelope `id` is resent after 2 s; on reconnect the outbox is resent and the receiver sees each `id` once (dedupe) |
| `event_store` | `backend/halo/event_store/tests/` | duplicate envelope `id` → one stored row (`events.id` UNIQUE is the second dedupe line) |

## Fixtures

| File | Scenario | Expected |
|---|---|---|
| `drop-ack.json` | First ACK is dropped | Hub resends the same `id` after 2 s; Gateway publishes once; one stored row |
| `duplicate.json` | Same envelope delivered twice | ACK `ok` both times; one Bus publish; one stored row |
| `unpaired.json` | Envelope arrives before `pair.ok` | ACK `error` with code `unpaired`; nothing published or stored |
| `invalid-schema.json` | Envelope fails its schema (`rank: 4`) | ACK `error` with code `invalid_schema`; nothing published or stored |
| `unknown-type.json` | Envelope `type` has no schema | ACK `error` with code `unknown_type`; nothing published or stored |

ACK error codes are a closed set: `invalid_schema | unknown_type | unpaired | internal`.
Pair rejection is `pair.rejected`, never an ACK error. A duplicate `id` gets
ACK `ok` again and is not re-published.
