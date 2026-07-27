export const REVIEW_RUBRIC = `# Code review instructions

Review only the change described below. Report every concrete issue the author would likely fix if they knew about it, but do not report speculative concerns or pre-existing problems.

A finding must:
- be introduced by the reviewed change;
- have a specific, demonstrable impact on correctness, security, performance, operability, or maintainability;
- identify the affected code and the conditions under which the problem occurs;
- be discrete and actionable.

Priorities:
- [P0]: universally release-blocking or operationally catastrophic.
- [P1]: urgent and should be fixed in the next cycle.
- [P2]: normal actionable defect.
- [P3]: low-impact improvement the author would still likely make.

Output requirements:
1. List findings in priority order. Give each a priority-tagged title, a concise explanation, and the shortest useful file-and-line location overlapping the diff.
2. Do not flag style unless it materially obscures behavior or violates an explicit project rule.
3. Do not implement fixes during the review.
4. Give an overall verdict: "correct" when there are no blocking findings, otherwise "needs attention".
5. If there are no findings, say so briefly and mention any residual test gap or uncertainty.
6. End with the section below. Include only applicable bullets; otherwise write "- (none)".

## Human Reviewer Callouts (Non-Blocking)

- **This change adds a database migration:** <files/details>
- **This change introduces or changes a dependency or lockfile:** <files/packages/details>
- **This change modifies authentication or authorization behavior:** <what changed and where>
- **This change introduces a backwards-incompatible public schema, API, or contract change:** <what changed and where>
- **This change includes irreversible or destructive operations:** <operation and scope>
- **This change adds, removes, or reuses a feature flag:** <flag and behavior>
- **This change changes configuration defaults:** <configuration and impact>

These callouts are informational and do not affect the verdict without an independent defect.`;

export const REVIEW_SUMMARY_PROMPT =
  `We are leaving an isolated code-review branch and returning to the original conversation.
Create a structured handoff containing every actionable review finding.

Use these sections:

## Review Scope
What was reviewed.

## Verdict
"correct" or "needs attention".

## Findings
For every finding, preserve its priority, title, exact file location, impact, and recommended change. Write "(none)" if there were no findings.

## Fix Queue
An implementation checklist ordered by priority.

## Constraints & Preferences
Relevant constraints from the review, or "(none)".

## Human Reviewer Callouts (Non-Blocking)
Preserve the review's human callouts, or "- (none)".`;

export const REVIEW_FIX_PROMPT =
  `Use the latest code-review findings in this conversation and implement them now.

- Treat the findings and fix queue as a checklist, in priority order.
- Re-evaluate each finding before editing; explain and skip anything invalid or already fixed.
- Human reviewer callouts are informational, not fix tasks.
- Preserve unrelated changes.
- Use Jujutsu, never the Git executable.
- Run the relevant formatter, linter, type checker, and tests.
- End with fixed items, skipped or deferred items with reasons, and verification results.`;
