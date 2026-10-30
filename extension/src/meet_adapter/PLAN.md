# meet_adapter: PLAN

## Job
Wave 3 (W2, Oct 31 afternoon – Nov 1). Critical path. The only module that knows Meet's DOM: implements the platform-neutral `MeetingAdapter` interface (`platform`, `matches(url)`, `tiles()`, `onTiles`, `onSpeaking`, `onJoin`, `onLeave`), keyed on `data-participant-id`, never class names. Supplies tiles, names, self tile (mirrored), speaking highlight, tile rect, `<video>`, object-fit, and an optional captions-band rect. Participant join/leave is reported to the hub over the Port (`onJoin`/`onLeave` are participants joining or leaving — nothing to do with the meeting lifecycle). `meeting.started` is sent by the hub at the Start click (DECISIONS §3), never by this module and never on a join; when the **self** user leaves Meet, the hub sends `meeting.ended` (`reason: left`). This module is the emitter of record for the tile/speaker contracts below.

## Inputs (contracts consumed)
Meet page DOM only. No socket, no bus. `MeetingAdapter` interface + tile shapes from `contracts`.

## Outputs (contracts emitted)
Emitter of record for `tiles.snapshot {tiles: [{tile_id (= data-participant-id), name, is_self, rect ([x,y,w,h] = getBoundingClientRect, viewport CSS px), video_w, video_h, fit, captions_rect: [x,y,w,h] | null}]}` and `speaker.active {tile_id, speaking, ts_ms}`, delivered two ways from the same in-tab value: directly in-tab to the Overlay + Frame Source, and over the Port to the hub → socket (⇄ ACK) → Gateway → Bus (Correlator + Event Store tap). The Overlay never consumes the socket copy. `captions_rect` is null when captions are off or the band is not found (accepted risk; Overlay then applies no floor). Flagged “inferred, Karim to confirm” in contracts.

## Lane (the files it owns)
`extension/src/meet_adapter/**` (+ tests). Runs inside the Meet content script (wrapper owned by `hub_capture`; this module owns its own code only).

## Depends on
`contracts` (`MeetingAdapter`, snapshot shapes). Day-0 `meet-overlay` probe gate: if tile rects or the speaking highlight are unreadable, there is **no pre-decided fallback — stop and come back to Karim** (say so in any PR). If `<video>` is absent, this module still works; `frame_source`/`face_detector` go silent and every tile is Frame mode (Path B stays cut).

## Fakes it tests with
Fake Meet layouts (`rig/fake_meet`: copied Meet DOM anchors, scripted join/leave, screen share, tile + canvas-only modes).

## Done = tests
Run: `npm --prefix extension test`; L3 `npm --prefix rig/fake_meet test`. Concrete cases (diagram box: Fake Meet layouts, join/leave, share): (1) each fixture tile yields a `tiles.snapshot` entry with stable `tile_id`, name, rect within the tile's painted bounds, correct `is_self` on the mirrored tile. (2) Scripted join/leave fires `onJoin`/`onLeave` once each and the next snapshot reflects it. (3) Speaking toggles emit `speaker.active` with the right `tile_id` and monotonic `ts_ms`, immediately (no AI wait). (4) Canvas-only mode (no `<video>`) still snapshots tiles with absent video fields — Frame mode downstream, no exception. (5) Captions band present → `captions_rect` set; absent → null. (6) Screen-share tile is reported as a tile (presenter points stay on the camera tile in the MVP; the share surface gets no points).

## Cut line
✂2: Zoom/Teams adapters (roadmap: new `MeetingAdapter`s for the web clients only). The Meet adapter itself is never cut (critical path).

## Doubts
Answered: dual delivery, `captions_rect`, probe stop-rule (batches 1–4). Answered (review): snapshot emission is event-driven (DOM mutation + 500 ms safety poll) rather than fixed-rate; `speaker.active` is emitted on highlight change only, so the bus never sees heartbeats.
