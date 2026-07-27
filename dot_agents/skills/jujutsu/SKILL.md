---
name: jujutsu
description: "Jujutsu workflow for every version-control task, including status, diffs, history, revisions, conflicts, bookmarks, and workspaces. Use whenever Git would ordinarily be used. Always use jj and never invoke the git executable."
---

# Jujutsu

Use `jj` for every version-control operation. Never run the `git` executable. Commands under `jj git` are allowed; if direct Git appears necessary, stop and ask.

- Scope inspection output. Start with `jj status` and, when needed, `jj diff --stat`; then limit `jj diff` to relevant revisions or filesets. Bound `jj log` with a revset and `--limit` where useful.
- Read historical files with `jj file show <path> -r <rev>`, filtering the output when only a fragment is needed.
- Trace a line with `jj file annotate <path> | rg -n -F '<text>'`, then inspect its revision with `jj log -r <rev>`. Continue from `<rev>-` and the earlier path when the change only moved or refactored the code.
- When updating an existing revision, work in a child revision and squash only when requested. Intermediate revisions are acceptable; report any cleanup they need. Use sibling revisions and separate workspaces only for independent approaches.
- Do not run destructive or history-rewriting operations such as `jj squash`, `jj abandon`, or broad `jj restore` commands unless requested or clearly required. Never discard unrelated changes.
- The user may rewrite history during a session. Re-run `jj status` and inspect `@-` before recreating apparently lost work.
- Do not push commits or bookmarks without an explicit request for that specific external action.
