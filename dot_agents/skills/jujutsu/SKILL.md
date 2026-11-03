---
name: jujutsu
description: "Jujutsu commands and revision management. Use for all version-control work."
---

# Jujutsu

- Keep inspection scoped: `jj status`, `jj diff --stat`, path-limited diffs, and bounded logs using revsets and `--limit`.
- Read historical files with `jj file show <path> -r <rev>`, filtering the output when only a fragment is needed.
- Trace a line with `jj file annotate <path> | rg -n -F '<text>'`, then inspect its revision with `jj log -r <rev>`. Continue from `<rev>-` and the earlier path when the change only moved or refactored the code.
- Reshape unpublished revisions created for the current task as needed. Splitting, squashing, and rebasing are normal tools for producing atomic, bisectable commits; preserve pre-existing and unrelated work.
- The user may rewrite history during a session. Re-run `jj status` and inspect `@-` before recreating apparently lost work.
