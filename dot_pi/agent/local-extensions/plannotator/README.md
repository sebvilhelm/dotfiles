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

After Plannotator exits, any returned feedback is queued as a user message in
the same Pi session. The commands wait for the review to finish. Install only
the standalone binary with Plannotator's minimal installer, which skips its
agent integrations:

```sh
curl -fsSL https://plannotator.ai/install.sh | bash -s -- --minimal
```

Restart Pi after applying the chezmoi settings so the conditional local
extension is discovered.
