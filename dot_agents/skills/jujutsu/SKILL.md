---
name: jujutsu
description: "Jujutsu version-control workflow. Use whenever inspecting repository status, history, diffs, or revisions; creating or modifying commits, bookmarks, or workspaces; resolving conflicts; or doing anything that would ordinarily use Git. Always use jj and never invoke the git executable."
---

# Jujutsu

Use `jj` for every version-control operation. Never run the `git` executable. Commands in the `jj git` namespace are allowed because they are executed through `jj`. If an operation appears to require the `git` executable, stop and ask instead.

## Inspection

- Start with `jj status` and use `jj diff`, `jj diff -r @-`, and `jj log` to inspect the working copy and history.
- Read a file at a revision with `jj file show <path> -r <rev>`.
- Use filesets to limit or exclude paths, such as `jj diff '~dir1 & ~dir2'` or `jj restore '~package-lock.json'`.
- To trace a line's origin, run `jj file annotate <path>`, inspect the identified revision with `jj log -r <rev>`, and continue from `<rev>-` when that revision only moved or refactored the code. Follow renames using the earlier path.
- Prefer local history over remote APIs when the needed information is already available in the repository.

## Working with revisions

- Make ordinary changes in the current working-copy revision.
- Intermediate revisions are acceptable for complex work. Use `jj commit` or `jj describe` followed by `jj new` to create reviewable checkpoints, and report any cleanup they need.
- When updating an existing revision, work in a child revision rather than editing the target revision directly. Squash into the target only when requested.
- For independent approaches, create sibling revisions from a common base with `jj new <base>`. Use `jj workspace add` when the approaches need separate working directories; return to the original directory, remove the temporary directory, and run `jj workspace forget <name>` after finishing.
- Local experimental revisions do not need bookmarks.

## Safety

- Do not run history-rewriting or destructive operations such as `jj squash`, `jj abandon`, or `jj restore` on unrelated paths unless requested or clearly required by the task.
- When an authorized squash must avoid opening an editor, use either `-m <message>` or `-u` to keep the destination message; these options are mutually exclusive.
- The user may rewrite or squash history during a session. Re-run `jj status` and inspect `@-` before concluding that work was lost or recreating changes.
- Do not push commits or bookmarks unless explicitly requested for that specific external action.
