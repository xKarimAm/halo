---
name: build-module
description: Build one Halo module end to end from its PLAN.md, test-first, and open a PR for review. Use when asked to build, implement or finish a named module (for example "/build-module transcriber").
---

# Build one Halo module

You own exactly one module: the one named in the command. Its folder, its PLAN.md and its tests are yours. Everything else in the repo is read-only to you: other modules, `/contracts`, `.agents/`, `.muse/`, `.github/`.

## 1. Load the module

Read, in order: the root `AGENTS.md`, `PLAN.md` (master), your module's `PLAN.md`, and every contract in `/contracts` that your module's PLAN.md lists as input or output. If your module calls a Meta model, load the `meta-model-api` skill.

Done when you can name, for your module: each input event type, each output event type, each acceptance check, and the test command.

## 2. Write the running state

Create or refresh `STATE.md` in your module folder with these headings: Goal, Key decisions, Task graph, File map, Current step, Open questions. Update it after every task you finish. Re-read a file before you change it, using the File map to find only the files a change touches.

Done when `STATE.md` exists with all six headings filled in. It is committed with the module and reviewed like code.

## 3. Pin the goal

In the interactive TUI, run `/goal Implement <module> per its PLAN.md; done ONLY when <test command from PLAN.md> passes and the contract tests for <module> pass.` In a headless run, where `/goal` is unavailable, write that same sentence as the first line under Goal in `STATE.md` and check it before you finish.

## 4. Build test-first

Use the `tdd` skill: one behaviour at a time, red then green, then refactor. The tests are the oracle. A test changes only when PLAN.md changes; if a test looks wrong, stop and write it under Open questions.

After every edit:
- Run the type check (`tsc --noEmit` or `ruff check` plus `mypy`) and the module's tests.
- Make the smallest edit that works. Use `edit` for existing files and `write` only for new ones.

Fakes stand in for every model call and every other module. Real meeting audio, video or faces never enter the repo: fixtures are synthetic or come from the shared fixture folder that `.gitignore` excludes.

## 5. When you get stuck

If the same command fails the same way three times, stop. Write what you tried and the exact error under Open questions, then report. A contract that doesn't fit your module is also a stop: describe the change you need under Open questions, because `/contracts` is owned by the orchestrator.

## 6. Ship

- Before committing, delete every scratch or probe file you created, so `git status` shows only the module's real files.
- Branch `module/<module>`. Commits follow Conventional Commits with the module as scope, for example `feat(transcriber): rotate session before 60 min`. One logical change per commit.
- Open a PR to `main` using the repo's PR template, filled in completely: contract checklist, acceptance checks ticked with evidence, test output, measured latency where PLAN.md sets a budget, and any deviation from PLAN.md with its reason.

Done when every acceptance check in your PLAN.md is ticked with evidence, CI is green on the PR, and the committed STATE.md shows no unresolved Open questions (or the PR lists them for the reviewer).
