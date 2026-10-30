# frame_source: PLAN

## Job
Wave 3 (W2, Oct 31 afternoon – Nov 1). Critical path (feeds the Face Detector). In-tab only: draws each tile's `<video>` to an OffscreenCanvas at ~10 fps, at most 6 tiles. Face frames never leave the browser and never cross the wire — the only video on the wire is the local recording (`kind=3` chunks from the hub). If the day-0 meet-overlay probe finds no `<video>`, this module emits nothing and every tile uses Frame mode (Path B is cut, DECISIONS §3: a video track cannot cross from the capture page to the Meet page).

## Inputs (contracts consumed)
Tile rects + `<video>` refs from the Meet Adapter (in-tab call, never on the wire). Tile set from `tiles.snapshot` (in-tab copy).

## Outputs (contracts emitted)
`TileFrame {tile_id, ts_ms, bitmap: ImageBitmap, frame_w, frame_h}` — in-tab only, never sent, no envelope, no ACK. `frame_w/h` define the space `faces.update` boxes use.

## Lane (the files it owns)
`extension/src/frame_source/**` (+ tests). Runs in the Meet content script (wrapper owned by `hub_capture`).

## Depends on
`contracts` (`TileFrame` shape), `meet_adapter` (video refs). Probe gate as above.

## Fakes it tests with
Fake Meet video + canvas-only modes (`rig/fake_meet`): tiles playing fixture video or CC0 photo faces via canvas MediaStreams at mismatched aspect ratios.

## Done = tests
Run: `npm --prefix extension test`; L3 `npm --prefix rig/fake_meet test`. Concrete cases (diagram box: Fake Meet video + canvas-only modes): (1) a video tile yields `TileFrame`s at ~10 fps with the tile's real `frame_w/h` and monotonic `ts_ms`. (2) Seven tiles → frames for at most 6 (first 6 by snapshot order; the rest are Frame mode downstream). (3) Canvas-only mode (no `<video>`) → zero frames, no error, Overlay falls back to Frame mode. (4) Bitmaps are transferred, not copied, to the detector worker (no per-frame allocation growth over a 60 s run in the L3 perf assert). (5) Nothing this module emits ever reaches the Port or socket (L3 asserts the wire carries only envelopes + `kind=1/3` binary).

## Cut line
Never cut while Face mode lives (critical path). If the probe kills `<video>`, this module ships empty by design (Frame mode for every tile) — that is the locked fallback, not a cut decision.

## Doubts
Answered: Path B cut + silence fallback (batch 4 gates). Answered (review): “first 6 tiles” means snapshot order, stable until a tile leaves; a joining 7th participant never evicts a tracked tile mid-meeting.
