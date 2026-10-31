# meet_adapter: DOM conventions

The anchors `MeetDomAdapter` reads, from the day-0 live probe on real Google
Meet (issue #47: Chrome, English UI, 1 participant, camera + captions on).
Keyed on `data-participant-id` plus the probe's `jsname` hook, never on
obfuscated class names (those can change on any Meet release — both probe
strings stay in `CONVENTIONS`). Constants live in `CONVENTIONS` in
`meet_adapter.ts`; probe results change the table, and this time the
speaking/self logic with it.

| Anchor | Meaning | Source |
|---|---|---|
| `[data-participant-id]` | Tile root; value = stable `tile_id` (`spaces/<id>/devices/<n>`) | Meet DOM / Fake Meet page |
| `[role="listitem"]` with a participant id | Participant panel row: never a tile | seed-fixture decoy |
| Several nodes, one participant id | Prefer the node holding a `<video>`; else the largest painted area | panel-row / fx decoys |
| `span.notranslate` inside the tile | Participant display name (fallback: first `span` with text outside any `button`) | skips icon text (`keep_outline`, `visual_effects`) |
| Tile containing an `<i>` whose text is `visual_effects` | Self (mirrored) tile: only your tile has the "Backgrounds and effects" button; the ligature is not localized (fallback: mirrored `<video>` transform). Unverified with a 2nd participant | probe |
| Descendant `[jsname="QgSmzd"]` with class `sxlEM` | Speaking highlight; level classes (`HX2H7` / `gjg47c` / `OgVli`) change alongside it and are ignored. `speaker.active` fires on change only, with a ~300 ms hold on `true` so brief drops do not flicker | probe |
| `[role="region"][aria-label="Captions"]` | Captions band rect (the Overlay's floor); absent or captions off = `captions_rect: null`. The aria-label is localized: fallback is the first text-bearing `[role="region"]`; the exact Arabic label lands with the 2-person live test | probe |
| `video.videoWidth/Height` | `video_w/h`; `0/0` when no `<video>` (camera off: the tile shows the initial avatar) | — |
| `object-fit` of the `<video>` | `fit`; real Meet uses `contain`; anything but `cover`/`contain` falls back to `cover` | probe |
| `getBoundingClientRect()` | `rect` `[x, y, w, h]`, viewport CSS px | — |
| Any tile-root node, incl. share surfaces | Reported as a tile (presenter points stay on the camera tile downstream) | share tile |

Emission: `MutationObserver` (structure + `class` on the speaking
descendant) + 500 ms safety poll (which also reconciles speaking, but never
re-arms a pending hold); `speaker.active` fires on highlight change only (no
heartbeats). `meeting.started` is never sent here (the hub owns it);
join/leave are participant events, not meeting lifecycle.

Open until the 2-person live test (gate 4): the self marker on the other
tile, the speaking class on a remote tile, multi-tile ids, pinning/resizing,
and the Arabic captions label.
