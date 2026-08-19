import assert from "node:assert/strict";
import {
  CHECKLIST_MESSAGE_TYPE,
  CONTINUE_MESSAGE_TYPE,
  DEFAULT_IMPLEMENTATION_MODEL,
  filterPrewalkControlMessages,
  GUIDE_MESSAGE_TYPE,
  IMPLEMENTATION_MESSAGE_TYPE,
  isSuccessfulImplementationAction,
  modelKey,
  parsePrewalkArguments,
  parseStoredPrewalkState,
} from "./core.ts";

Deno.test("parses default and model-selecting prewalk commands", () => {
  assert.deepEqual(parsePrewalkArguments("fix the cache race"), {
    task: "fix the cache race",
    selectModels: false,
  });
  assert.deepEqual(parsePrewalkArguments("--models fix the cache race"), {
    task: "fix the cache race",
    selectModels: true,
  });
  assert.deepEqual(parsePrewalkArguments("-m add regression coverage"), {
    task: "add regression coverage",
    selectModels: true,
  });
  assert.deepEqual(parsePrewalkArguments("--models fix one\nthen fix two"), {
    task: "fix one\nthen fix two",
    selectModels: true,
  });
  assert.deepEqual(parsePrewalkArguments("--unknown task"), {
    error: "Unknown prewalk option: --unknown",
  });
  assert.deepEqual(parsePrewalkArguments("  "), {
    error: "Usage: /prewalk [--models] <implementation task>",
  });
});

Deno.test("switches only after successful file-mutation tools", () => {
  assert.equal(
    isSuccessfulImplementationAction({ toolName: "edit", isError: false }),
    true,
  );
  assert.equal(
    isSuccessfulImplementationAction({
      toolName: "apply_patch",
      isError: false,
    }),
    true,
  );
  assert.equal(
    isSuccessfulImplementationAction({ toolName: "write", isError: true }),
    false,
  );
  assert.equal(
    isSuccessfulImplementationAction({ toolName: "bash", isError: false }),
    false,
  );
});

Deno.test("uses Luna as the default implementation model", () => {
  assert.deepEqual(DEFAULT_IMPLEMENTATION_MODEL, {
    provider: "openai",
    id: "gpt-5.6-luna",
  });
});

Deno.test("round-trips valid persisted state and rejects malformed state", () => {
  assert.deepEqual(
    parseStoredPrewalkState({
      status: "armed",
      implementationModel: { provider: "openai", id: "gpt-5.6-luna" },
      continuationPending: false,
    }),
    {
      status: "armed",
      implementationModel: { provider: "openai", id: "gpt-5.6-luna" },
      continuationPending: false,
    },
  );
  assert.deepEqual(parseStoredPrewalkState({ status: "finished" }), {
    status: "finished",
  });
  assert.equal(
    parseStoredPrewalkState({
      status: "armed",
      implementationModel: { provider: "openai" },
    }),
    undefined,
  );
  assert.equal(parseStoredPrewalkState(null), undefined);
});

Deno.test("formats canonical model keys", () => {
  assert.equal(
    modelKey({ provider: "openai", id: "gpt-5.6-sol" }),
    "openai/gpt-5.6-sol",
  );
});

Deno.test("keeps only the current prewalk phase instructions in context", () => {
  const text = (id: string) => ({ role: "user", id });
  const control = (customType: string, id: string) => ({
    role: "custom",
    customType,
    id,
  });
  const messages = [
    control(GUIDE_MESSAGE_TYPE, "old-guide"),
    text("old-work"),
    control(IMPLEMENTATION_MESSAGE_TYPE, "old-implementation"),
    control(GUIDE_MESSAGE_TYPE, "current-guide"),
    text("exploration"),
    control(CONTINUE_MESSAGE_TYPE, "old-continue"),
    text("more-exploration"),
    control(CONTINUE_MESSAGE_TYPE, "current-continue"),
  ];

  assert.deepEqual(
    filterPrewalkControlMessages(messages).map(({ id }) => id),
    [
      "old-work",
      "current-guide",
      "exploration",
      "more-exploration",
      "current-continue",
    ],
  );

  const implemented = [
    ...messages,
    control(IMPLEMENTATION_MESSAGE_TYPE, "current-implementation"),
    control(CHECKLIST_MESSAGE_TYPE, "current-checklist"),
  ];
  assert.deepEqual(
    filterPrewalkControlMessages(implemented).map(({ id }) => id),
    [
      "old-work",
      "exploration",
      "more-exploration",
      "current-checklist",
    ],
  );
});
