# SAM 3.1 (Face Tracker)

- **Live tracking runs on open weights**: `facebookresearch/sam3` with the `sam3.1_multiplex_fp16` checkpoint on the local GPU, or the same worker on Modal. The hosted Meta SAM API processes uploaded files only and has no live frame inference, so it is never the live path. When the worker is unavailable, the overlay uses Frame mode.
- Use Meta's official repo directly. The Ultralytics wrapper is AGPL-3.0, which would force the whole repo under AGPL.
- Prompt with one short English noun phrase per request ("face" or "person").
- The worker keeps a one-slot queue per tile and always processes the newest frame, dropping stale ones, so tracking never lags behind the video.
- Load the model once at worker start (Modal: `@modal.enter()`), and import it lazily behind an interface so tests and CI run with a fake tracker and no weights.
- To parse hosted API output, use `meta_sam_parser` (Python) or `@meta-sam/parser` (TS) instead of the raw grammar. Check the `meta-models/meta-sam` LICENSE file before adding either as a dependency.
- Layout ideas for the overlay come from Meta's "headlocked speech-bubble captions" recipe: derive a head anchor from the mask, keep each person's points on a stable side, avoid covering other people, highlight the active speaker.
- Frames are processed in memory and never written to disk.
