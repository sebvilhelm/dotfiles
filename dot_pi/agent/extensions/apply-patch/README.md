# Apply Patch

Pi extension that exposes Codex's `apply_patch` tool to OpenAI models. It uses
Pi's grammar-constrained sampling support so compatible models receive the same
freeform Lark grammar used by Codex rather than a JSON function schema.

The extension is active only when the selected model's provider is `openai`.
Switching to another provider removes it from the active tool set; switching
back enables it again.

## Patch format

The tool accepts Codex-style V4A patches:

```text
*** Begin Patch
*** Add File: hello.txt
+Hello, world!
*** Update File: src/example.ts
@@
-const enabled = false;
+const enabled = true;
*** Delete File: obsolete.txt
*** End Patch
```

Supported operations:

- `*** Add File: <path>` creates a UTF-8 text file. Every content line must
  start with `+`.
- `*** Update File: <path>` applies context-based update hunks.
- `*** Move to: <path>` after an update header moves the updated file.
- `*** Delete File: <path>` deletes a file.
- `*** End of File` constrains an update hunk to the end of a file.

Successful calls return Codex-style output:

```text
Success. Updated the following files:
A hello.txt
M src/example.ts
D obsolete.txt
```

## Safety

The implementation intentionally tightens several filesystem behaviors:

- Paths must be relative to Pi's current working directory and cannot traverse
  outside it.
- Symlink targets and symlinked parent directories are rejected.
- `Add File` fails if the target already exists.
- Moves fail if the destination already exists.
- Update and delete operations fail if the target does not exist or is not UTF-8
  text.
- Every operation is parsed and staged before filesystem changes begin.
- Updates preserve existing line endings and UTF-8 byte-order marks.
- Files participate in Pi's shared mutation queue so concurrent `edit`, `write`,
  and `apply_patch` calls cannot overwrite one another.
- Cancellation is observed while waiting, staging, and mutating; cancellation or
  filesystem failures during mutation trigger a best-effort rollback.
- Result output is truncated to Pi's 2,000-line or 50KB limit.

These checks differ from some Codex harness versions that permit `Add File` or
move operations to overwrite existing paths.

## Files

- `index.ts` registers the tool, Lark grammar, model activation hooks, and TUI
  renderers.
- `core.ts` parses, validates, stages, and applies patches.
- `core_test.ts` contains parser, mutation, conflict, and path-safety tests.

## Verification

From the chezmoi source directory:

```sh
deno fmt --check dot_pi/agent/extensions/apply-patch
deno lint dot_pi/agent/extensions/apply-patch
deno check \
  dot_pi/agent/extensions/apply-patch/core.ts \
  dot_pi/agent/extensions/apply-patch/core_test.ts
deno test --allow-env --allow-read --allow-write \
  dot_pi/agent/extensions/apply-patch/core_test.ts
pi -e ./dot_pi/agent/extensions/apply-patch/index.ts --list-models
```

## References

- [OpenAI Apply Patch guide](https://developers.openai.com/api/docs/guides/tools-apply-patch)
- [Codex apply-patch grammar](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/apply_patch.lark)
- [Pi extension documentation](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
