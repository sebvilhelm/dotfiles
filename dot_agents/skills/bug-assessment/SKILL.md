---
name: bug-assessment
description: "Assess suspected software bugs and review findings before proposing fixes. Use when asked whether reported behavior, an incident hypothesis, or a review finding is a real and currently reachable defect."
---

# Bug Assessment

Investigate without modifying code unless the user asks for a fix.

Start with a direct verdict: `confirmed`, `likely`, `possible`, `unlikely`, or `not a bug`.

Support it with:

- **Defect:** Identify the exact incorrect behavior or violated invariant. Suspicious code alone is insufficient.
- **Reachability:** Establish whether current callers, configuration, and data can execute the faulty path.
- **Occurrence:** Separate evidence that the defect exists from evidence that it has happened, such as a reproduction, test, logs, or persisted data.
- **Confidence:** State confidence in the verdict.
- **Missing evidence:** Name the evidence that would materially change or settle the verdict.

Assess independent claims separately. Do not infer occurrence from reachability or present a plausible failure mode as an observed incident.
