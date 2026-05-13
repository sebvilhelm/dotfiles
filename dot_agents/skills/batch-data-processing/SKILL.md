---
name: batch-data-processing
description: "Process many similar items safely and iteratively. Use whenever work involves a list of PRs, API resources, files, records, or other items that could tempt immediate fan-out; validate the pipeline on one item before scaling up."
---

# Batch Data Processing

Use this skill when the task has the shape "do the same analysis or extraction for many items."

## Workflow

1. Do not fan out across the full input set immediately.
2. Pick one representative item and run the full pipeline end-to-end first.
3. Work out the exact commands, API calls, fields, parsing steps, intermediate artifacts, and output format on that one item.
4. Verify that the extracted data is actually useful. If needed, try one or two more items to catch bad assumptions.
5. Only once the procedure is solid, scale up. Start with a small batch before processing everything in parallel.
6. Save reusable helpers or notes if the task is likely to recur.

## What to look for during the pilot run

- Which fields actually matter
- Whether the data model matches expectations
- Whether parsing logic is robust enough for realistic variation
- Whether the final output is shaped correctly for the user's goal

The point is to avoid discovering schema mistakes or bad extraction logic after doing a large amount of work.
