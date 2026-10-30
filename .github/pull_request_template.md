## Module / lane

<!-- One module per PR. Branch: module/<module>. Karim merges every PR. -->

## What changed

<!-- Short summary. Link the issue(s): Fixes #<n> -->

## Contract checklist

- [ ] No contract changed, or this PR has the `contract-change` label and names the `/contracts` change
- [ ] Golden samples / generated types updated via `uv run python -m contracts.codegen` (no hand edits to `contracts/gen/` or `contracts/ext/gen/`)
- [ ] Only files inside my lane changed (the one exception: `backend/halo/app.py` wiring lines for my own backend module)

## Acceptance checks (from my module's PLAN.md "Done = tests")

- [ ] Each check ticked below with evidence (command + result)

<!-- Paste the checks from PLAN.md here, ticked, with evidence for each. -->

## Test output

<!-- Paste the real output: test command(s), pass/fail counts. Add measured latency where PLAN.md sets a budget. -->

## Deviations from PLAN.md

<!-- Any deviation, with its reason. Write "none" if there are none. -->
