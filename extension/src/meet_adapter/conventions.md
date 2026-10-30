# meet_adapter: DOM conventions

The anchors `MeetDomAdapter` reads. Keyed on `data-participant-id`, never on
class names. Constants live in `CONVENTIONS` in `meet_adapter.ts`; probe
results change the table, not the logic.

| Anchor | Meaning | Source |
|---|---|---|
| `[data-participant-id]` | Tile root; value = stable `tile_id` | Meet DOM / Fake Meet page |
| `[role="listitem"]` with a participant id | Participant panel row: never a tile | seed-fixture decoy |
| Several nodes, one participant id | Prefer the node holding a `<video>`; else the largest painted area | panel-row / fx decoys |
| First `span` with text outside any `button` | Participant display name | skips icon text (`keep_outline`) |
| `data-self="true"` on the tile root | Self (mirrored) tile | placeholder until the probe names the real marker (mirrored `<video>` transform is the fallback check) |
| `data-speaking="true"` on the tile root | Speaking highlight | Fake Meet toggles this; the real-Meet selector lands with the day-0 `meet-overlay` probe |
| `[data-captions-band]` | Captions band rect (the Overlay's floor); absent or captions off = `captions_rect: null` | Fake Meet renders one when captions are on |
| `video.videoWidth/Height` | `video_w/h`; `0/0` when no `<video>` (canvas-only tile) | — |
| `object-fit` of the `<video>` | `fit`; anything but `cover`/`contain` falls back to `cover` | Fake Meet uses `cover` at mismatched aspect ratios |
| `getBoundingClientRect()` | `rect` `[x, y, w, h]`, viewport CSS px | — |
| Any tile-root node, incl. share surfaces | Reported as a tile (presenter points stay on the camera tile downstream) | share tile |

Emission: `MutationObserver` (structure + speaking attr) + 500 ms safety
poll; `speaker.active` fires on highlight change only (no heartbeats).
`meeting.started` is never sent here (the hub owns it); join/leave are
participant events, not meeting lifecycle.
