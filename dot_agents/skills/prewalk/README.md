# Prewalk

Prewalk starts an implementation task on a strong guide model, preserves that model's exploration and first edit in the conversation, then lets a cheaper executor model finish from the same context. It follows the workflow described in [You only need the frontier model for one single edit](https://stencil.so/blog/prewalk).

The skill is explicit-only and does not switch models automatically. Use it in a harness that preserves the conversation when changing models.

## Using it in Pi

1. Start the task with the guide model selected.
2. Invoke the skill and include the complete task:

   ```text
   /skill:prewalk Fix the race in the session cache and add regression coverage
   ```

3. Let the guide explore, create its 5–9 item checklist, and make the first substantive edit. It will stop with:

   ```text
   PREWALK READY — switch to the executor model in this same session, then say "continue".
   ```

4. Run `/model` and select the cheaper executor model.
5. In the same session, send:

   ```text
   continue
   ```

The executor resumes the existing checklist, completes the implementation, and runs the required verification.

## Important constraints

- Keep the handoff in the same session. Do not start a new conversation or copy only the plan; the explored context and first edit are the useful handoff state.
- Do not clear or compact the conversation between models.
- Wait for the handoff marker before switching. A failed edit or a checklist update does not count as the first implementation edit.
- Use prewalk for implementation tasks that require file changes. It has little value for read-only analysis or tasks already small enough to finish in one edit.
- If the harness has no todo facility, the guide uses a Markdown checklist in the conversation.

For another compatible harness, invoke the `prewalk` skill explicitly, switch models after the handoff marker, and continue in the same conversation.
