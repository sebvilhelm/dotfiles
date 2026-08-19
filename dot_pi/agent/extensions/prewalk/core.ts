export const DEFAULT_GUIDE_MODEL = {
  provider: "openai",
  id: "gpt-5.6-sol",
} as const;

export const DEFAULT_IMPLEMENTATION_MODEL = {
  provider: "openai",
  id: "gpt-5.6-luna",
} as const;

export const GUIDE_THINKING_LEVEL = "high" as const;
export const IMPLEMENTATION_THINKING_LEVEL = "high" as const;

export const GUIDE_MESSAGE_TYPE = "prewalk-guide";
export const CONTINUE_MESSAGE_TYPE = "prewalk-continue";
export const IMPLEMENTATION_MESSAGE_TYPE = "prewalk-implementation";
export const CHECKLIST_MESSAGE_TYPE = "prewalk-checklist";

export const PREWALK_GUIDE_PROMPT =
  `Plan deeply, then capture the plan as a Markdown todo list, then start implementation.

You are the frontier model in a prewalk run. The useful handoff artifact is this same conversation and worktree, not a standalone plan document.

Before changing task files:
1. Read the applicable project instructions and inspect the relevant code, tests, history, and documentation until the approach is grounded in the actual code.
2. State the concrete plan in the conversation: ordered changes, exact files and symbols, risks and edge cases, and the validation for each change.
3. Capture that plan as a Markdown todo list of 5–9 meaningful implementation and validation items. Do not create a plan file.

Then begin implementation. Make exactly one coherent, substantive task-file edit that demonstrates the approach and leaves the worktree in a sensible intermediate state. A test or reproduction may be that edit when the plan calls for it. Do not make a throwaway edit, do not pack the whole task into the first edit, and do not issue multiple mutating tool calls in parallel. Once that edit succeeds, make no further tool calls in this turn; the prewalk extension will switch models before the next turn.

Do not stop after writing the plan. Continue through the first implementation edit in this run.`;

export const PREWALK_CONTINUE_PROMPT =
  `Continue the prewalk frontier phase now. Do not merely restate the plan or announce that you are ready. Complete the required exploration and todo list if needed, then make the first coherent implementation edit.`;

export const PREWALK_CHECKLIST_PROMPT = `Before task complete, verify:

- Consistency: If a pattern, signature, or check changed in one place, grep every other call site or duplicate copy needing identical change. A fix at only some matching sites fails.
- Scope: If diff exceeds the minimal issue-resolving change, confirm behavior unchanged outside the reported issue. Prefer the smallest correct diff over a broader rewrite.
- Verification: Run the issue's full test module or file, not only the expected-to-flip test. A sibling-test-breaking change fails.

Do not claim task complete until all three checks are done.`;

export type ParsedPrewalkArguments =
  | { task: string; selectModels: boolean }
  | { error: string };

const MODEL_SELECTOR_OPTIONS = new Set([
  "--models",
  "--select-models",
  "-m",
]);

export function parsePrewalkArguments(
  argumentsText: string,
): ParsedPrewalkArguments {
  const input = argumentsText.trim();
  if (input.length === 0) {
    return { error: "Usage: /prewalk [--models] <implementation task>" };
  }

  const separator = input.search(/\s/);
  const first = separator < 0 ? input : input.slice(0, separator);
  if (MODEL_SELECTOR_OPTIONS.has(first)) {
    const task = separator < 0 ? "" : input.slice(separator).trim();
    return task.length > 0
      ? { task, selectModels: true }
      : { error: "Usage: /prewalk --models <implementation task>" };
  }

  if (first.startsWith("-")) {
    return { error: `Unknown prewalk option: ${first}` };
  }

  return { task: input, selectModels: false };
}

const IMPLEMENTATION_TOOLS = new Set(["edit", "write", "apply_patch"]);

export interface ToolResultSummary {
  toolName: string;
  isError: boolean;
}

export function isSuccessfulImplementationAction(
  result: ToolResultSummary,
): boolean {
  return !result.isError && IMPLEMENTATION_TOOLS.has(result.toolName);
}

export interface ModelReference {
  provider: string;
  id: string;
}

export function modelKey(model: ModelReference): string {
  return `${model.provider}/${model.id}`;
}

export interface PrewalkContextMessage {
  role: string;
  customType?: string;
}

export function filterPrewalkControlMessages<T extends PrewalkContextMessage>(
  messages: readonly T[],
): T[] {
  let lastGuide = -1;
  let lastContinue = -1;
  let lastImplementation = -1;
  let lastChecklist = -1;

  for (const [index, message] of messages.entries()) {
    if (message.role !== "custom") continue;
    if (message.customType === GUIDE_MESSAGE_TYPE) lastGuide = index;
    if (message.customType === CONTINUE_MESSAGE_TYPE) lastContinue = index;
    if (message.customType === IMPLEMENTATION_MESSAGE_TYPE) {
      lastImplementation = index;
    }
    if (message.customType === CHECKLIST_MESSAGE_TYPE) lastChecklist = index;
  }

  if (lastGuide < 0 && lastImplementation < 0) return [...messages];
  const guidePhase = lastGuide > lastImplementation;

  return messages.filter((message, index) => {
    if (message.role !== "custom") return true;
    if (message.customType === GUIDE_MESSAGE_TYPE) {
      return guidePhase && index === lastGuide;
    }
    if (message.customType === CONTINUE_MESSAGE_TYPE) {
      return guidePhase && index === lastContinue && index > lastGuide;
    }
    if (message.customType === IMPLEMENTATION_MESSAGE_TYPE) {
      return false;
    }
    if (message.customType === CHECKLIST_MESSAGE_TYPE) {
      return !guidePhase && index === lastChecklist &&
        index > lastImplementation;
    }
    return true;
  });
}

export interface StoredPrewalkState {
  status: "armed" | "finished";
  implementationModel?: ModelReference;
  continuationPending?: boolean;
}

export function parseStoredPrewalkState(
  value: unknown,
): StoredPrewalkState | undefined {
  if (typeof value !== "object" || value === null || !("status" in value)) {
    return undefined;
  }
  if (value.status === "finished") {
    return { status: "finished" };
  }
  if (
    value.status !== "armed" ||
    !("implementationModel" in value) ||
    typeof value.implementationModel !== "object" ||
    value.implementationModel === null ||
    !("provider" in value.implementationModel) ||
    typeof value.implementationModel.provider !== "string" ||
    !("id" in value.implementationModel) ||
    typeof value.implementationModel.id !== "string"
  ) {
    return undefined;
  }

  return {
    status: "armed",
    implementationModel: {
      provider: value.implementationModel.provider,
      id: value.implementationModel.id,
    },
    continuationPending: "continuationPending" in value &&
        value.continuationPending === false
      ? false
      : true,
  };
}
