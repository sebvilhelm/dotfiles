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
2. Run `go build ./...` to verify the project still builds.
3. Run relevant tests.
4. Use `go test -run` to target the relevant tests instead of running the entire suite.
