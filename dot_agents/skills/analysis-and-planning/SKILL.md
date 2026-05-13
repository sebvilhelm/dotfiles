---
name: analysis-and-planning
description: "Create resumable analysis and planning documents for proposed features, investigations, and design work. Use whenever the user asks for analysis, planning, feasibility work, design review, or a design doc review before implementation."
---

# Analysis and Planning

Use this skill to make exploratory work easy to resume and easy to hand off.

## Workflow

1. Start writing immediately in `tmp/notes` relative to the repo root. Create the directory if it does not exist.
2. Create two markdown files up front, both with descriptive names that start with `YYYY-MM-DD`:
   - `...-analysis.md` for the detailed working document
   - `...-plan.md` for the shorter implementation-facing plan
3. Put the user prompt or goal at the top of the analysis doc and fill it in as the work progresses. Do not wait until the end to write it up.
4. Keep the analysis doc thorough and resumable. Capture context, findings, constraints, relevant file paths, alternatives considered, open questions, and the reasoning behind the recommendation.
5. Keep the plan doc shorter and more action-oriented. Focus on the recommended approach, major steps, risks, dependencies, rollout, and validation.
6. When reviewing or improving a design doc, engage with the design itself. Test assumptions, edge cases, migration concerns, observability, and validation strategy instead of only editing prose.
7. Be explicit about alternatives, but spend most of the space on realistic options.

## Output expectations

The analysis doc is the reference document another agent should be able to pick up later.

The plan doc is the document an implementer should be able to read quickly before starting work.
