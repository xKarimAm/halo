# Agent instructions

**Start here:** read `docs/DECISIONS.md` (every locked decision; it wins over older docs), then `docs/PLAN.md` (the build plan) and your module's `PLAN.md`. Architecture: `docs/architecture/halo-v2-final.drawio`.

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

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Workflow skills (plugin `mattpocock-skills`)

Load the skill when its moment comes:

- a live failure: `diagnosing-bugs`
- each fix: `tdd` (the test goes red before the fix)
- opening a PR: `pr`; before handing it to Karim: `code-review`
- a decision for Karim: `grilling`
- `GLOSSARY.md` or `docs/adr/`: `domain-modeling`
- `AGENTS.md`, `CLAUDE.md`, `.remember/` handovers: `writing-for-agents`

## One of each: replace, never stack

A repeat Start, a reconnect or a new meeting replaces the running instance. Keep these singular, and test it when you touch them:

| One | Enforced by |
|---|---|
| socket per offscreen hub; capture per Start | hub (`extension/src/hub_capture`) |
| producer per audio stream (newest socket wins) | Gateway `AudioRouter` |
| open meeting: one tab and one mic Voice session, one turn pump | Transcriber |
| backend per port | the OS: a second `uv run halo` exits with "address in use" |

## Git inside the Muse sandbox

Muse runs shell commands as a separate sandbox user, so plain `git` stops with "detected dubious ownership". Run every git command as `git -c safe.directory=* <command>`. `gh` works only when Karim started Muse with `GH_TOKEN` and `GH_CONFIG_DIR=E:\halo-gh` set; if `gh` says "Access is denied", stop and tell Karim.