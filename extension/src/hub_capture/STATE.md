# hub_capture: STATE

## Goal
Implement extension/src/hub_capture per its PLAN.md; done ONLY when `npm --prefix extension test` passes and the contract tests for hub_capture pass.

## Key decisions
- Core hub is transport-agnostic (injected socket, Port, clock, id generator, storage); Chrome/WebSocket wiring lives in the thin entrypoints so Vitest covers the Done cases deterministically.
- Issue #6 answered (see that issue): Start handoff = runtime message `halo/hub.start` handled by the hub; tile names for setup_panel = hub writes `halo/tileNames` to `chrome.storage.local` on every tiles.snapshot (no contracts change).
- `wxt.config.ts` sits at the extension root (where WXT reads it), not `extension/src/` as the PLAN lane line literally says; noted as a deviation in the PR. Manifest `key` is a pinned generated public key so the extension id never changes.
- The Meet content-script wrapper dynamically imports meet_adapter/frame_source/overlay and tolerates their absence, so this PR builds before those lanes merge.

## Task graph
1. Outbox (ACK 2 s resend same id, 3 tries then degraded, inbound dedupe).
2. Hub (pair.hello first, meeting lifecycle, Port relay, set_viewer_lang resend, recorder switch, audio/rec framing, tile-names storage, start handoff).
3. Capture helpers (100 ms PCM16 chunking, stream routing, AudioContext replay seam).
4. Entrypoints (offscreen, Meet content wrapper) + wxt.config/manifest.
5. Vitest Done cases (1)-(6) + #6 API tests.

## File map
- `extension/src/hub_capture/outbox.ts`: resend/dedupe.
- `extension/src/hub_capture/hub.ts`: the hub.
- `extension/src/hub_capture/capture.ts`: PCM chunking/routing/replay.
- `extension/src/hub_capture/*.test.ts`: Done-case tests.
- `extension/src/entrypoints/offscreen/main.ts`, `extension/src/entrypoints/meet/main.ts`: thin boots.
- `extension/wxt.config.ts`: composition root config + manifest.

## Current step
Review fix pushed: socket reconnects with backoff (1 s, 2 s, 4 s, cap 5 s), no resend on close, nothing sent on a non-open socket, `pair.hello` direct on open (not via outbox), everything else held until `pair.ok` then resent once with the same ids. 10 Vitest cases green, typecheck clean. Then rebased on main.

## Open questions
- L3 full form (hub opens on the Fake Meet page via `?halo_test=1`) runs once this module's `.output` and meet_adapter coexist on main; the hook and fixture-audio path are unit-tested here.
