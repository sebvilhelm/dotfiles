# Prewalk extension

`/prewalk` runs an implementation task on a guide model, then switches to an
implementation model in the same Pi session after the first successful
`edit`, `write`, or `apply_patch` result.

By default it uses:

- Guide: `openai/gpt-5.6-sol` with `high` reasoning
- Implementation: `openai/gpt-5.6-luna` with `medium` reasoning

Start a run with the defaults:

```text
/prewalk Fix the race in the session cache and add regression coverage
```

Use `--models` (or `-m`) to choose both models for one run. The selectors use
the session's scoped models when configured, matching Pi's model scope:

```text
/prewalk --models Fix the race in the session cache and add regression coverage
```

The selected models are per-run; the reasoning levels remain `high` for the
guide and `medium` for implementation. Pi clamps them when a selected model
does not support those levels.

The extension injects hidden guide and implementation instructions, preserves
the conversation and worktree across the switch, and persists an armed
handoff in the session so it survives `/reload` or resume. Failed edits do not
trigger the switch. A bounded continuation nudge prevents a prose-only plan
from silently ending the run without looping on repeated prose responses.
