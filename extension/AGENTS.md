# extension/

The Chrome MV3 extension: WXT + TypeScript, built with npm. It holds no API keys; the hub (offscreen doc) keeps the one WebSocket to the backend.

## Lanes

Each folder under `src/` is one lane, labelled `module:<folder>`:

| Folder | Job |
|---|---|
| `hub_capture/` | Hub (offscreen doc, socket, outbox, resend), tab + mic capture. Also the composition root: `wxt.config.ts`, the manifest, `src/entrypoints/meet.content.ts` |
| `setup_panel/` | Toolbar popup: pairing UI, meeting context, Start |
| `meet_adapter/` | Reads Meet's DOM: tiles, names, speaking highlight (`conventions.md` = Meet DOM notes) |
| `frame_source/` | Reads each tile's `<video>` |
| `face_detector/` | Face boxes per tile (`assets/` = bundled binary model) |
| `overlay/` | Bubbles, name pills, badge, toasts on the Meet page (`tokens.ts` = design tokens) |

`src/entrypoints/` holds thin WXT wrappers that call into the lanes. The Port protocol between Meet-page modules and the hub is typed in `contracts/ext/port.ts`; envelope types are generated into `contracts/ext/gen/types.ts` (contracts lane).

## Working in a module

1. Read the module's `STATE.md`: its **File map** names every file. Open only those files.
2. `PLAN.md` in the same folder is the spec. Tests sit next to the code as `*.test.ts`.
3. UI source of truth: `docs/ui/overlay-mix-b.html` (tokens) and `docs/ui/OVERLAY-UX.md` (geometry, timing).

## Tests

- All: `npm --prefix extension test` and `npm --prefix extension run typecheck` (what CI runs)
- One module: `cd extension && npx vitest run src/<module>`. Vitest must start inside `extension/`; a `--root extension` run from elsewhere reports false failures.
- End to end on the Fake Meet page: `rig/AGENTS.md`

## Generated, read only when debugging a build

`.output/` (build output, `npm run build`), `.wxt/` (WXT types), `node_modules/`. The pinned extension id and how it is derived: `README.md`.
