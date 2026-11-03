---
name: herdr
description: "Control Herdr panes, layouts, commands, and agents. Use only when the user explicitly mentions Herdr or asks to use it, not for generic background work or delegation. Requires HERDR_ENV=1."
---

# Herdr

Herdr organizes terminals into workspaces, tabs, and panes, recognizes agents running inside panes, and exposes the current session through the `herdr` CLI.

## Session and command discovery

Before inspecting or controlling a session, verify that this agent is running inside a Herdr-managed pane:

```bash
test "${HERDR_ENV:-}" = 1
```

If the check fails, report that you are outside Herdr and stop; do not control the focused session from outside Herdr.

The installed binary is the authority for syntax. Use `herdr --help` and the relevant top-level command group without a subcommand, such as `herdr agent` or `herdr pane`, to discover commands.

Do not run bare `herdr` for discovery; it launches or attaches the TUI. Do not probe a mutating nested command by omitting arguments: `herdr workspace create`, for example, executes with defaults.

## Targeting and layout

- Use `--current`, an explicit pane ID, or a unique live agent name. An omitted target may resolve to the UI-focused pane, which can belong to the user or another client.
- Parse IDs from JSON responses; they are opaque handles, not sidebar positions. Workspace IDs look like `w1`, tab IDs like `w1:t1`, and pane IDs like `w1:p1`. Closed tab and pane IDs are not reused.
- Herdr injects `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, and `HERDR_PANE_ID` into each managed pane.
- After `pane move`, use `.result.move_result.pane.pane_id` or the live agent name. The previous ID only continues resolving through the moved process’s inherited caller context; it is not a general target.
- Creation responses expose the next targets: `workspace create` returns `.result.workspace`, `.result.tab`, and `.result.root_pane`; `tab create` returns `.result.tab` and `.result.root_pane`; `pane split` returns `.result.pane`.

Discover live state with the relevant commands:

```bash
herdr workspace list
herdr tab list --workspace "$HERDR_WORKSPACE_ID"
herdr pane current --current
herdr pane list --workspace "$HERDR_WORKSPACE_ID"
herdr agent list
```

Default to a sibling pane in the current tab and working directory. Use another workspace, tab, worktree, or cwd only when the user requests it. Preserve user focus with `--no-focus` for background work.

## Panes, agents, and lifecycle

Pane commands operate on raw terminals and ordinary processes. Agent commands validate the recognized agent in a pane and interpret its lifecycle. `agent start` needs an existing available shell pane; it never creates or rearranges layout.

Agent commands accept a unique live agent name or its pane ID, not terminal IDs or bare agent-kind labels. Names match `[a-z][a-z0-9_-]{0,31}` and are cleared when the occupant exits, is released, or is replaced.

- `idle`: ready for input, and its tab has been seen in the focused UI.
- `done`: the same underlying idle state after unseen background work finishes. Focusing marks it seen; CLI reads do not.
- `blocked`: a recognized approval or question UI.
- `unknown`: an agent is present but cannot be classified confidently; this is not proof of completion.

Read [coordination recipes](references/coordination.md) when creating panes, starting or prompting agents, running commands, waiting, or recovering output. The reference covers readiness and wait semantics, logical keys, read sources, and alternate-screen limitations.

## Protect the session

- Do not close workspaces, tabs, panes, or sessions you did not create unless the user asked.
- Do not run `herdr server stop` unless the user intends to stop the server and its pane processes. Never kill the main Herdr process; use named test sessions for isolated-server experiments.
- Server errors are JSON on stderr with exit status 1; CLI syntax errors exit with status 2.
