# Personal review extension

Jujutsu-native local and GitHub pull-request review workflows for Pi.

## Commands

```text
/review-local
/review-local trunk [--focus "..."] [--isolated|--current-session]
/review-local wc [--focus "..."] [--isolated|--current-session]
/review-local revset <expr> [--focus "..."] [--isolated|--current-session]

/review-pr <number|GitHub URL> [--focus "..."] [--isolated|--current-session]
/end-review [return|summarize|fix]
/review-restore
/review-instructions [text|clear]
```

Interactive reviews ask whether to use an isolated conversation branch when the
session already contains messages. Explicit commands also work without
interactive UI when a target and end action are supplied.

## PR working-copy behavior

`/review-pr`:

1. Reads PR metadata with `gh`.
2. Fetches the base and head bookmarks using `jj git fetch`, including fork
   remotes.
3. Verifies the fetched head against GitHub's reported commit.
4. Records the original working-copy change and commit IDs for restoration.
5. Creates an empty working-copy change on top of the PR head, keeping fixes
   separate from imported history.

`/end-review return` and `/end-review summarize` restore the original working
copy. `/end-review fix` leaves the working copy on the PR fix change and queues
a fix turn; run `/review-restore` afterward. Review changes remain in Jujutsu
history.

Restoration prefers the change ID to follow rewrites, falling back to the saved
commit ID if Jujutsu automatically abandoned an empty, undescribed working copy
when starting the review. Older sessions without a saved commit ID may need
manual recovery. Find the operation before the review, resolve the original
change there, then edit its commit at the current operation:

```sh
jj op log
jj --at-op <operation> log -r <change-id> --no-graph -T commit_id
jj edit <commit-id>
```

Run `/review-restore` afterward to clear the pending restore.

The extension never creates local bookmarks, invokes the Git executable, or
pushes bookmarks.

## Project instructions

When the project is trusted, a repository-root `REVIEW_GUIDELINES.md` is
appended to the shared review rubric. `/review-instructions` stores additional
instructions in the current Pi session.

## Verification

From the dotfiles repository root:

```sh
deno fmt --check dot_pi/agent/extensions/review
deno lint dot_pi/agent/extensions/review
deno test dot_pi/agent/extensions/review/core_test.ts
PI_PACKAGE_DIR=/path/to/installed/pi-coding-agent \
  node --test dot_pi/agent/extensions/review/runtime_test.mjs
```

The runtime tests use the installed Pi TypeScript loader and real temporary
Jujutsu repositories under `tmp`. They do not call GitHub or a model.
