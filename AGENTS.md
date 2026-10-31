# Agent instructions

**Start here:** read `docs/DECISIONS.md` (every locked decision; it wins over older docs), then the map for your area below, then your module's `PLAN.md` and `STATE.md`. Master build plan: `docs/PLAN.md`.

## Repo map

| Area | Map | Lanes (folder = lane, label = `module:<folder>`) |
|---|---|---|
| `backend/` | `backend/AGENTS.md` | bus, llm, gateway, transcriber, correlator, insight, classifier, event_store, notes_builder, notes_service, recorder |
| `extension/` | `extension/AGENTS.md` | hub_capture, setup_panel, meet_adapter, frame_source, face_detector, overlay |
| `notes-page/` | `notes-page/AGENTS.md` | notes-page |
| `rig/` | `rig/AGENTS.md` | fakes, replayer, fake_meet |
| `contracts/` | `contracts/AGENTS.md` | contracts |
| `packaging/`, root files, `backend/halo/app.py` | `packaging/PLAN.md` | packaging |
| `docs/` | `docs/DECISIONS.md` | none (Karim + Claude) |

Which window (W1-W3) owns which lane: DECISIONS §6. Rules for calling Meta models: `.agents/skills/meta-model-api/`.

## Finding things

1. A module's `STATE.md` has a **File map** of every file it owns. Read it before searching, then open only the files it names.
2. Search inside the area or module folder you work in rather than the repo root.
3. Read large files by line range: find the symbol first, then read around it.
4. Searches skip lockfiles and the architecture diagram (root `.ignore`). The diagram is one 70-90 KB line of XML and DECISIONS §3 summarises it; open `docs/architecture/halo-v2-final.drawio` only to edit it.
5. Locked dependency versions: `npm --prefix extension ls <pkg>` or `uv tree --package <pkg>`. Claude cannot read lockfiles or `.env` (`.claude/settings.json`).

## Agent skills

### Issue tracker

Tickets live in this repo's GitHub Issues, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Module lanes: agents talk through issues

Each module is one agent's **lane**: you write only inside your module's folder. Anything you need from another lane, or from `/contracts`, goes to its owner as an issue:

1. **Raise:** `gh issue create --label module:<target> --label needs-triage`. The body says what you need, why, and the contract field or failing test that shows it. A change to `/contracts` also gets `--label contract-change` and waits for Karim (Claude reviews it).
2. **Keep moving:** if the issue blocks you, add `--label blocked` and a `Blocked by #<n>` line to your own ticket, then continue against the fake or golden sample from `/contracts`.
3. **Check your inbox** before each task and before each PR: `gh issue list --label module:<your-module> --state open`. Answer with a comment; close it from your PR with `Fixes #<n>`.

Karim merges every PR.

### Triage labels

Five default labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

`GLOSSARY.md` and `docs/adr/` are not written yet; DECISIONS.md holds the terms. Their format: `docs/agents/domain.md`.

## Git inside the Muse sandbox

Muse runs shell commands as a separate sandbox user, so plain `git` stops with "detected dubious ownership". Run every git command as `git -c safe.directory=* <command>`. `gh` works only when Karim started Muse with `GH_TOKEN` and `GH_CONFIG_DIR=E:\halo-gh` set; if `gh` says "Access is denied", stop and tell Karim.
