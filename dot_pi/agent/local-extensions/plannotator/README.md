# Local Plannotator bridge

This local Pi extension calls the standalone `plannotator` executable. It does
not import or install `@plannotator/pi-extension`.

The settings template loads it only when `work_laptop` is true. It is kept under
`local-extensions/`, outside Pi's automatically discovered `extensions/`
directory.

Commands:

- `/plannotator-review [PR_URL]` reviews current changes or a supplied PR.
- `/plannotator-last` annotates the latest visible assistant text on the current
  session branch.
- `/plannotator-annotate <file-or-folder>` annotates a document or folder.

Start reviews while Pi is idle. The commands return immediately, so you can keep
submitting prompts while the browser review is open. The status line shows when
reviews are active.

After Plannotator exits, any returned feedback is sent as a user message in the
same Pi session (queued as a follow-up if Pi is already working). Reloading,
switching sessions, or exiting Pi stops the child processes and discards late
feedback, so it cannot be delivered to another session.

Install only the standalone binary with Plannotator's minimal installer, which
skips its agent integrations:

```sh
curl -fsSL https://plannotator.ai/install.sh | bash -s -- --minimal
```

Restart Pi after applying the chezmoi settings so the conditional local
extension is discovered.

## Verification

```sh
deno fmt --check dot_pi/agent/local-extensions/plannotator
deno lint dot_pi/agent/local-extensions/plannotator
deno test dot_pi/agent/local-extensions/plannotator/core_test.ts
PI_PACKAGE_DIR=/path/to/installed/pi-coding-agent \
  node --test dot_pi/agent/local-extensions/plannotator/runtime_test.mjs
```

Runtime tests keep a mock browser review open to verify that command handlers
return before the child exits, then exercise feedback, overlapping reviews,
errors, and session-shutdown cleanup.
