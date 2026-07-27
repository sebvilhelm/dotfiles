---
name: go-projects
description: "Go development workflow and style for this environment. Use whenever editing Go code, tests, modules, or build logic: prefer current Go idioms, use the local style rules here, and run the relevant Go verification commands afterward."
---

# Go Projects

## Style

- Use the latest available Go syntax and standard library features when they improve the code.
- `go fix` can help upgrade syntax, but revert unrelated changes.
- Prefer local mapper functions over inline mapping or package-level mapper helpers unless the mapping is materially more complex than copying primitive fields or slices.
- Prefer struct methods for collection-style helpers.
- Use `testify/assert` and `testify/require` in tests.

## Verification

After changing Go code:

1. Run `go fmt` on the changed files.
2. Run the relevant targeted tests, using `go test <packages> -run <pattern>` when appropriate; broaden the test scope as warranted by the change.
3. Run the repository's documented lint, static-analysis, and build commands that cover the changed code.
4. Use `go build ./...` only when the repository supports building its full package tree together. Otherwise, use the documented build command or build the affected command packages.
