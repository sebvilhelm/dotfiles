---
name: typescript-projects
description: "TypeScript and JavaScript workflow for this environment. Use whenever editing TS or JS code, especially types and package-based tooling: read current library docs, avoid `any` and unnecessary casts, and run the relevant package commands afterward."
---

# TypeScript Projects

## Approach

- Read current online docs for libraries before relying on remembered usage details.
- When working on types, avoid `any` and avoid casting unless there is no sound alternative. Model the types correctly.

## Verification

After changing TypeScript or JavaScript code:

1. Check `package.json` for the project's lint, format, typecheck, and test commands.
2. Run the commands that are relevant to the changed files.
