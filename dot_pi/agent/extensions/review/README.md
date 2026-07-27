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

Interactive reviews ask whether to use an isolated conversation branch when the session already contains messages. Explicit commands also work without interactive UI when a target and end action are supplied.

## PR working-copy behavior

`/review-pr`:

1. Reads PR metadata with `gh`.
2. Fetches the base and head bookmarks using `jj git fetch`, including fork remotes.
3. Verifies the fetched head against GitHub's reported commit.
4. Sets `pi-review/pr-<number>` to the PR head.
5. Preserves the original working copy with a temporary local bookmark.
6. Creates an empty working-copy change on top of the PR head, keeping fixes separate from imported history.

`/end-review return` and `/end-review summarize` restore the original working copy. `/end-review fix` leaves the working copy on the PR fix change and queues a fix turn; run `/review-restore` afterward. Review changes remain in Jujutsu history.

The extension never invokes the Git executable or pushes bookmarks.

## Project instructions

When the project is trusted, a repository-root `REVIEW_GUIDELINES.md` is appended to the shared review rubric. `/review-instructions` stores additional instructions in the current Pi session.
