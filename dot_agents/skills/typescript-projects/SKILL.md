---
name: typescript-projects
description: "TypeScript and JavaScript typing, API usage, and verification. Use when editing TS or JS code."
---

# TypeScript Projects

## Approach

- Resolve API uncertainty against the installed library version, using local types/source or version-matched documentation.
- When working on types, avoid `any` and avoid casting unless there is no sound alternative. Model the types correctly.

## Verification

After changing TypeScript or JavaScript code:

1. Check `package.json` for the project's lint, format, typecheck, and test commands.
2. Run the commands that are relevant to the changed files.
