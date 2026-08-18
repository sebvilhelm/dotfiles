import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  CONTINUE_MESSAGE_TYPE,
  DEFAULT_GUIDE_MODEL,
  DEFAULT_IMPLEMENTATION_MODEL,
  filterPrewalkControlMessages,
  GUIDE_MESSAGE_TYPE,
  GUIDE_THINKING_LEVEL,
  IMPLEMENTATION_MESSAGE_TYPE,
  IMPLEMENTATION_THINKING_LEVEL,
  isSuccessfulImplementationAction,
  modelKey,
  parsePrewalkArguments,
  parseStoredPrewalkState,
  PREWALK_CONTINUE_PROMPT,
  PREWALK_GUIDE_PROMPT,
  PREWALK_IMPLEMENTATION_PROMPT,
  type StoredPrewalkState,
} from "./core.ts";

const STATE_ENTRY_TYPE = "prewalk-state";

interface ActivePrewalk {
  implementationModel: Model<Api>;
  continuationPending: boolean;
  switching: boolean;
}

function uniqueModels(models: readonly Model<Api>[]): Model<Api>[] {
  const unique = new Map<string, Model<Api>>();
  for (const model of models) {
    unique.set(modelKey(model), model);
  }
  return [...unique.values()].sort((left, right) =>
    modelKey(left).localeCompare(modelKey(right))
  );
}

function selectableModels(ctx: ExtensionContext): Model<Api>[] {
  const scoped = ctx.scopedModels.map(({ model }) => model);
  return uniqueModels(
    scoped.length > 0 ? scoped : ctx.modelRegistry.getAvailable(),
  );
}

function modelLabel(model: Model<Api>): string {
  const key = modelKey(model);
  return model.name && model.name !== model.id ? `${key} — ${model.name}` : key;
}

async function selectModel(
  ctx: ExtensionContext,
  title: string,
  models: readonly Model<Api>[],
  preferred: { provider: string; id: string },
): Promise<Model<Api> | undefined> {
  const ordered = [...models].sort((left, right) => {
    const leftPreferred = modelKey(left) === modelKey(preferred);
    const rightPreferred = modelKey(right) === modelKey(preferred);
    if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1;
    return modelKey(left).localeCompare(modelKey(right));
  });
  const byLabel = new Map(ordered.map((model) => [modelLabel(model), model]));
  const selected = await ctx.ui.select(title, [...byLabel.keys()]);
  return selected === undefined ? undefined : byLabel.get(selected);
}

function updateStatus(
  ctx: ExtensionContext,
  active: ActivePrewalk | undefined,
): void {
  ctx.ui.setStatus(
    "prewalk",
    active
      ? ctx.ui.theme.fg(
        "accent",
        `prewalk→${active.implementationModel.id}`,
      )
      : undefined,
  );
}

function storedState(active: ActivePrewalk): StoredPrewalkState {
  return {
    status: "armed",
    implementationModel: {
      provider: active.implementationModel.provider,
      id: active.implementationModel.id,
    },
    continuationPending: active.continuationPending,
  };
}

export default function prewalkExtension(pi: ExtensionAPI): void {
  let active: ActivePrewalk | undefined;

  const persistActive = (): void => {
    if (active) pi.appendEntry(STATE_ENTRY_TYPE, storedState(active));
  };

  const finish = (ctx: ExtensionContext): void => {
    active = undefined;
    pi.appendEntry(STATE_ENTRY_TYPE, { status: "finished" });
    updateStatus(ctx, active);
  };

  pi.registerCommand("prewalk", {
    description:
      "Run an implementation task with a guide-to-executor model handoff; use --models to select models",
    getArgumentCompletions: (prefix) => {
      const option = {
        value: "--models",
        label: "--models",
        description: "Choose the guide and implementation models for this run",
      };
      return option.value.startsWith(prefix) ? [option] : null;
    },
    handler: async (argumentsText, ctx) => {
      await ctx.waitForIdle();

      if (active) {
        ctx.ui.notify(
          `Prewalk is already armed for ${
            modelKey(active.implementationModel)
          }`,
          "warning",
        );
        return;
      }

      const parsed = parsePrewalkArguments(argumentsText);
      if ("error" in parsed) {
        ctx.ui.notify(parsed.error, "error");
        return;
      }

      let guideModel = ctx.modelRegistry.find(
        DEFAULT_GUIDE_MODEL.provider,
        DEFAULT_GUIDE_MODEL.id,
      );
      let implementationModel = ctx.modelRegistry.find(
        DEFAULT_IMPLEMENTATION_MODEL.provider,
        DEFAULT_IMPLEMENTATION_MODEL.id,
      );

      if (parsed.selectModels) {
        if (!ctx.hasUI) {
          ctx.ui.notify(
            "/prewalk --models requires a dialog-capable mode",
            "error",
          );
          return;
        }
        const models = selectableModels(ctx);
        if (models.length === 0) {
          ctx.ui.notify("No authenticated models are available", "error");
          return;
        }

        guideModel = await selectModel(
          ctx,
          `Prewalk guide model (${GUIDE_THINKING_LEVEL} reasoning)`,
          models,
          DEFAULT_GUIDE_MODEL,
        );
        if (!guideModel) return;

        implementationModel = await selectModel(
          ctx,
          `Implementation model (${IMPLEMENTATION_THINKING_LEVEL} reasoning)`,
          models,
          DEFAULT_IMPLEMENTATION_MODEL,
        );
        if (!implementationModel) return;
      }

      if (!guideModel) {
        ctx.ui.notify(
          `Default guide model ${modelKey(DEFAULT_GUIDE_MODEL)} is unavailable`,
          "error",
        );
        return;
      }
      if (!implementationModel) {
        ctx.ui.notify(
          `Default implementation model ${
            modelKey(DEFAULT_IMPLEMENTATION_MODEL)
          } is unavailable`,
          "error",
        );
        return;
      }

      if (!(await pi.setModel(guideModel))) {
        ctx.ui.notify(
          `No credentials are available for ${modelKey(guideModel)}`,
          "error",
        );
        return;
      }
      pi.setThinkingLevel(GUIDE_THINKING_LEVEL);

      active = {
        implementationModel,
        continuationPending: true,
        switching: false,
      };
      persistActive();
      updateStatus(ctx, active);

      pi.sendMessage(
        {
          customType: GUIDE_MESSAGE_TYPE,
          content: PREWALK_GUIDE_PROMPT,
          display: false,
          details: {
            guideModel: modelKey(guideModel),
            implementationModel: modelKey(implementationModel),
          },
        },
        { deliverAs: "nextTurn" },
      );
      ctx.ui.notify(
        `Prewalk: ${modelKey(guideModel)}:${GUIDE_THINKING_LEVEL} → ${
          modelKey(implementationModel)
        }:${IMPLEMENTATION_THINKING_LEVEL}`,
        "info",
      );
      pi.sendUserMessage(parsed.task);
    },
  });

  pi.on("turn_end", async (event, ctx) => {
    const current = active;
    if (!current || current.switching) return;

    const action = event.toolResults.find(isSuccessfulImplementationAction);
    if (action) {
      current.switching = true;
      const switched = await pi.setModel(current.implementationModel);
      if (switched) {
        pi.setThinkingLevel(IMPLEMENTATION_THINKING_LEVEL);
      }

      pi.sendMessage(
        {
          customType: IMPLEMENTATION_MESSAGE_TYPE,
          content: switched
            ? PREWALK_IMPLEMENTATION_PROMPT
            : `${PREWALK_IMPLEMENTATION_PROMPT}\n\nThe requested model switch failed, so continue on the current model.`,
          display: false,
          details: {
            implementationModel: modelKey(current.implementationModel),
            triggerTool: action.toolName,
            switched,
          },
        },
        { deliverAs: "steer" },
      );

      if (switched) {
        ctx.ui.notify(
          `Prewalk: switched to ${
            modelKey(current.implementationModel)
          }:${IMPLEMENTATION_THINKING_LEVEL} after ${action.toolName}`,
          "info",
        );
      } else {
        ctx.ui.notify(
          `Prewalk could not switch to ${
            modelKey(current.implementationModel)
          }; continuing on the guide model`,
          "error",
        );
      }
      finish(ctx);
      return;
    }

    if (event.toolResults.length > 0) {
      if (!current.continuationPending) {
        current.continuationPending = true;
        persistActive();
      }
      return;
    }

    if (!current.continuationPending) return;
    current.continuationPending = false;
    persistActive();
    pi.sendMessage(
      {
        customType: CONTINUE_MESSAGE_TYPE,
        content: PREWALK_CONTINUE_PROMPT,
        display: false,
      },
      { deliverAs: "steer", triggerTurn: true },
    );
  });

  pi.on("context", (event) => {
    return { messages: filterPrewalkControlMessages(event.messages) };
  });

  pi.on("session_start", (_event, ctx) => {
    active = undefined;
    const stateEntry = [...ctx.sessionManager.getBranch()].reverse().find(
      (entry) =>
        entry.type === "custom" && entry.customType === STATE_ENTRY_TYPE,
    );
    const state = stateEntry?.type === "custom"
      ? parseStoredPrewalkState(stateEntry.data)
      : undefined;
    if (state?.status === "armed" && state.implementationModel) {
      const implementationModel = ctx.modelRegistry.find(
        state.implementationModel.provider,
        state.implementationModel.id,
      );
      if (implementationModel) {
        active = {
          implementationModel,
          continuationPending: state.continuationPending ?? true,
          switching: false,
        };
      } else {
        ctx.ui.notify(
          `Stored prewalk target ${
            modelKey(state.implementationModel)
          } is unavailable; prewalk was disarmed`,
          "warning",
        );
      }
    }
    updateStatus(ctx, active);
  });
}
