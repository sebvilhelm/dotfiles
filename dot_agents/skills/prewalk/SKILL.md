---
name: prewalk
description: "Prepare implementation tasks for a same-context model handoff: explore deeply, create a bounded verification-aware checklist, and land one representative edit before a cheaper executor continues. Invoke explicitly when starting work on a frontier model and finishing it on another model."
disable-model-invocation: true
---

# Prewalk

Use this workflow only for implementation work that will continue in the same conversation after a model switch. The trajectory is the handoff artifact; do not replace it with a standalone plan document or a fresh executor session.

Determine the phase from the conversation. If a prewalk checklist and the first implementation edit already exist, enter the executor phase. Otherwise, enter the guide phase.

## Guide phase

1. Read the applicable project instructions and inspect the relevant code, tests, history, and documentation. Explore until the approach is grounded in the actual code and the important risks are understood.
2. Before changing task files, state a concrete plan in the conversation: ordered changes, exact files and symbols, known risks and edge cases, and the commands or observations that will verify each change. Briefly record anything already completed so it is not repeated.
3. Capture the plan as a checklist of 5–9 meaningful items. Use the harness's todo facility when available; otherwise use a Markdown checklist in the conversation. Every implementation item must name its validation. Exclude reporting, bookkeeping, and ceremonial cleanup items.
4. Start implementing. Make one coherent, substantive edit that demonstrates the chosen approach and leaves the worktree in a sensible intermediate state. A test or reproduction may be first when the plan calls for it. Do not make a throwaway change merely to reach the handoff, and do not deliberately pack the whole task into an oversized first edit.
5. Immediately after the first successful task-file edit, stop using tools. Do not make another change or begin validation. Mark the checklist's actual progress, then reply:

   `PREWALK READY — switch to the executor model in this same session, then say "continue".`

A failed edit does not trigger the handoff. Creating or updating the checklist is not an implementation edit.

## Executor phase

The guide-phase instructions expire after the first implementation edit.

1. Continue from the existing exploration, checklist, worktree, and first edit. Do not restart planning or repeat reads solely to reconstruct context already present; inspect additional or changed material when needed.
2. Work through the remaining checklist, keeping its status current. When the code contradicts the plan, fix the actual problem and revise the checklist rather than forcing the original plan.
3. Apply all project-specific formatting, linting, typechecking, build, and test requirements. Validate each meaningful item before marking it complete.
4. Before finishing, check for matching call sites or duplicate patterns that need the same change, review the diff for unintended scope, and run the full relevant test module or file rather than only the narrow test expected to pass.
5. Do not claim completion while any checklist item or required verification remains unresolved. Report blockers explicitly.
