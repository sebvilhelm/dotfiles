import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { IsolationPreference } from "./core.ts";
import {
  REVIEW_FIX_PROMPT,
  REVIEW_RUBRIC,
  REVIEW_SUMMARY_PROMPT,
} from "./rubric.ts";

const REVIEW_STATE_TYPE = "personal-review-state-v1";
const REVIEW_ANCHOR_TYPE = "personal-review-anchor-v1";
const REVIEW_SETTINGS_TYPE = "personal-review-settings-v1";
const REVIEW_RESTORE_TYPE = "personal-review-restore-v1";
const REVIEW_WIDGET_ID = "personal-review";

type NotificationLevel = "info" | "warning" | "error";

export type RepositoryRestoreState = {
  repoRoot: string;
  originalChangeId: string;
  originBookmark: string;
  bookmark: string;
  pullRequestNumber: number;
};

export type ReviewRequest = {
  kind: "local" | "pull-request";
  repoRoot: string;
  label: string;
  scope: string;
  commands: string[];
  focus?: string;
  isolate: boolean;
  restore?: RepositoryRestoreState;
};

type ActiveReviewState = {
  active: true;
  kind: "local" | "pull-request";
  label: string;
  conversationOriginId?: string;
  restore?: RepositoryRestoreState;
};

type InactiveReviewState = { active: false };
type ReviewState = ActiveReviewState | InactiveReviewState;

type ReviewSettings = { customInstructions?: string };

type PendingRestoreState = RepositoryRestoreState & {
  pending: boolean;
  reviewChangeId?: string;
};

type EndAction = "return" | "summarize" | "fix";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRestoreState(value: unknown): value is RepositoryRestoreState {
  return (
    isRecord(value) &&
    typeof value.repoRoot === "string" &&
    typeof value.originalChangeId === "string" &&
    typeof value.originBookmark === "string" &&
    typeof value.bookmark === "string" &&
    typeof value.pullRequestNumber === "number"
  );
}

function isReviewState(value: unknown): value is ReviewState {
  if (!isRecord(value) || typeof value.active !== "boolean") {
    return false;
  }
  if (!value.active) {
    return true;
  }
  return (
    (value.kind === "local" || value.kind === "pull-request") &&
    typeof value.label === "string" &&
    (value.conversationOriginId === undefined ||
      typeof value.conversationOriginId === "string") &&
    (value.restore === undefined || isRestoreState(value.restore))
  );
}

function isReviewSettings(value: unknown): value is ReviewSettings {
  return isRecord(value) &&
    (value.customInstructions === undefined ||
      typeof value.customInstructions === "string");
}

function isPendingRestoreState(value: unknown): value is PendingRestoreState {
  if (!isRecord(value) || !isRestoreState(value)) {
    return false;
  }
  return (
    "pending" in value &&
    typeof value.pending === "boolean" &&
    (!("reviewChangeId" in value) ||
      value.reviewChangeId === undefined ||
      typeof value.reviewChangeId === "string")
  );
}

export function notify(
  ctx: ExtensionContext,
  message: string,
  level: NotificationLevel,
): void {
  if (ctx.hasUI) {
    ctx.ui.notify(message, level);
    return;
  }
  const writer = level === "error" ? console.error : console.log;
  writer(message);
}

function latestCustomData(
  ctx: ExtensionContext,
  customType: string,
  branchOnly: boolean,
): unknown {
  const entries = branchOnly
    ? ctx.sessionManager.getBranch()
    : ctx.sessionManager.getEntries();
  let data: unknown;
  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === customType) {
      data = entry.data;
    }
  }
  return data;
}

async function loadProjectGuidelines(
  ctx: ExtensionContext,
  repoRoot: string,
): Promise<string | undefined> {
  if (!ctx.isProjectTrusted()) {
    return undefined;
  }
  try {
    const content = await readFile(
      join(repoRoot, "REVIEW_GUIDELINES.md"),
      "utf8",
    );
    return content.trim() || undefined;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function currentChangeId(
  pi: ExtensionAPI,
  repoRoot: string,
): Promise<string | undefined> {
  const result = await pi.exec(
    "jj",
    [
      "--repository",
      repoRoot,
      "--no-pager",
      "log",
      "-r",
      "@",
      "--no-graph",
      "-T",
      'change_id ++ "\\n"',
    ],
    { timeout: 5_000 },
  );
  return result.code === 0 ? result.stdout.trim() || undefined : undefined;
}

export class ReviewWorkflow {
  private activeState: ActiveReviewState | undefined;
  private customInstructions: string | undefined;
  private endInProgress = false;

  constructor(private readonly pi: ExtensionAPI) {
    pi.on(
      "session_start",
      (_event: unknown, ctx: ExtensionContext) => this.restoreSessionState(ctx),
    );
    pi.on(
      "session_tree",
      (_event: unknown, ctx: ExtensionContext) => this.restoreSessionState(ctx),
    );
  }

  registerCommands(): void {
    this.pi.registerCommand("review-instructions", {
      description:
        "Set or clear shared instructions used by local and PR reviews",
      handler: (args: string, ctx: ExtensionCommandContext) =>
        this.configureInstructions(args, ctx),
    });

    this.pi.registerCommand("end-review", {
      description:
        "Finish an active review and optionally summarize or fix findings",
      handler: (args: string, ctx: ExtensionCommandContext) =>
        this.endReview(args, ctx),
    });

    this.pi.registerCommand("review-restore", {
      description:
        "Return to the working-copy change active before the last PR review",
      handler: (_args: string, ctx: ExtensionCommandContext) =>
        this.restorePendingWorkingCopy(ctx),
    });
  }

  isActive(): boolean {
    return this.activeState !== undefined;
  }

  async chooseIsolation(
    ctx: ExtensionCommandContext,
    preference?: IsolationPreference,
  ): Promise<boolean | undefined> {
    if (preference) {
      return preference === "isolated";
    }
    if (!ctx.hasUI) {
      return false;
    }

    const messageCount = ctx.sessionManager
      .getEntries()
      .filter((entry) => entry.type === "message").length;
    if (messageCount === 0) {
      return true;
    }

    const choice = await ctx.ui.select("Start review in:", [
      "Isolated review branch",
      "Current session",
    ]);
    if (choice === undefined) {
      return undefined;
    }
    return choice === "Isolated review branch";
  }

  async start(
    ctx: ExtensionCommandContext,
    request: ReviewRequest,
  ): Promise<boolean> {
    if (this.activeState) {
      notify(
        ctx,
        `A review is already active: ${this.activeState.label}`,
        "warning",
      );
      return false;
    }

    if (!ctx.isIdle()) {
      notify(
        ctx,
        "Waiting for the agent to become idle before starting the review",
        "info",
      );
    }
    await ctx.waitForIdle();

    const conversationOriginId = request.isolate
      ? await this.createReviewBranch(ctx)
      : undefined;
    if (request.isolate && !conversationOriginId) {
      return false;
    }

    const state: ActiveReviewState = {
      active: true,
      kind: request.kind,
      label: request.label,
      conversationOriginId,
      restore: request.restore,
    };
    this.activeState = state;
    this.pi.appendEntry(REVIEW_STATE_TYPE, state);
    this.setWidget(ctx);

    try {
      const projectGuidelines = await loadProjectGuidelines(
        ctx,
        request.repoRoot,
      );
      const prompt = this.buildPrompt(request, projectGuidelines);
      notify(
        ctx,
        `Starting review: ${request.label}${
          request.isolate ? " (isolated branch)" : ""
        }`,
        "info",
      );
      this.pi.sendUserMessage(prompt);
      return true;
    } catch (error) {
      if (conversationOriginId) {
        try {
          await ctx.navigateTree(conversationOriginId, { summarize: false });
        } catch {
          this.setWidget(ctx);
          throw error;
        }
      }
      this.clearState(ctx);
      throw error;
    }
  }

  async restorePreparedRepository(
    ctx: ExtensionContext,
    restore: RepositoryRestoreState,
  ): Promise<boolean> {
    return await this.restoreWorkingCopy(ctx, { ...restore, pending: true });
  }

  private restoreSessionState(ctx: ExtensionContext): void {
    const state = latestCustomData(ctx, REVIEW_STATE_TYPE, true);
    this.activeState = isReviewState(state) && state.active ? state : undefined;

    const settings = latestCustomData(ctx, REVIEW_SETTINGS_TYPE, false);
    this.customInstructions = isReviewSettings(settings)
      ? settings.customInstructions?.trim() || undefined
      : undefined;
    this.setWidget(ctx);
  }

  private setWidget(ctx: ExtensionContext): void {
    if (!ctx.hasUI) {
      return;
    }
    if (!this.activeState) {
      ctx.ui.setWidget(REVIEW_WIDGET_ID, undefined);
      return;
    }
    const suffix = this.activeState.restore
      ? " • working copy switched for PR review"
      : "";
    ctx.ui.setWidget(REVIEW_WIDGET_ID, [
      `Review active: ${this.activeState.label}${suffix}`,
      "Finish with /end-review",
    ]);
  }

  private clearState(ctx: ExtensionContext): void {
    this.activeState = undefined;
    this.pi.appendEntry(
      REVIEW_STATE_TYPE,
      { active: false } satisfies InactiveReviewState,
    );
    this.setWidget(ctx);
  }

  private async createReviewBranch(
    ctx: ExtensionCommandContext,
  ): Promise<string | undefined> {
    let originId = ctx.sessionManager.getLeafId() ?? undefined;
    if (!originId) {
      this.pi.appendEntry(REVIEW_ANCHOR_TYPE, {
        createdAt: new Date().toISOString(),
      });
      originId = ctx.sessionManager.getLeafId() ?? undefined;
    }
    if (!originId) {
      notify(ctx, "Could not create a review branch anchor", "error");
      return undefined;
    }

    const firstUserMessage = ctx.sessionManager
      .getEntries()
      .find((entry) =>
        entry.type === "message" && entry.message.role === "user"
      );
    if (firstUserMessage) {
      const result = await ctx.navigateTree(firstUserMessage.id, {
        summarize: false,
        label: "code-review",
      });
      if (result.cancelled) {
        return undefined;
      }
      ctx.ui.setEditorText("");
    }

    return originId;
  }

  private buildPrompt(
    request: ReviewRequest,
    projectGuidelines?: string,
  ): string {
    const sections = [
      REVIEW_RUBRIC,
      "---",
      "Review the following change in this Jujutsu repository.",
      `Repository root: ${request.repoRoot}`,
      `Review target: ${request.label}`,
      `Scope: ${request.scope}`,
      "Use Jujutsu commands, never the Git executable.",
      "Start with:",
      ...request.commands.map((command) => `- ${command}`),
      "Then read the changed files and relevant surrounding code before reporting findings.",
    ];
    if (request.focus) {
      sections.push(`Additional focus: ${request.focus}`);
    }
    if (this.customInstructions) {
      sections.push(`Shared review instructions:\n${this.customInstructions}`);
    }
    if (projectGuidelines) {
      sections.push(`Project review guidelines:\n${projectGuidelines}`);
    }
    return sections.join("\n\n");
  }

  private async configureInstructions(
    rawArgs: string,
    ctx: ExtensionCommandContext,
  ): Promise<void> {
    const args = rawArgs.trim();
    let instructions: string | undefined;
    if (args === "clear") {
      instructions = undefined;
    } else if (args) {
      instructions = args;
    } else {
      if (!ctx.hasUI) {
        notify(ctx, "Usage: /review-instructions <text|clear>", "error");
        return;
      }
      const result = await ctx.ui.editor(
        "Shared review instructions (empty input clears them):",
        this.customInstructions ?? "",
      );
      if (result === undefined) {
        return;
      }
      instructions = result.trim() || undefined;
    }

    this.customInstructions = instructions;
    this.pi.appendEntry(
      REVIEW_SETTINGS_TYPE,
      { customInstructions: instructions } satisfies ReviewSettings,
    );
    notify(
      ctx,
      instructions
        ? "Shared review instructions saved"
        : "Shared review instructions cleared",
      "info",
    );
  }

  private parseEndAction(
    rawArgs: string,
    ctx: ExtensionCommandContext,
  ): Promise<EndAction | undefined> | EndAction | undefined {
    const value = rawArgs.trim();
    if (value) {
      if (value === "return" || value === "summarize" || value === "fix") {
        return value;
      }
      notify(ctx, "Usage: /end-review [return|summarize|fix]", "error");
      return undefined;
    }
    if (!ctx.hasUI) {
      notify(ctx, "Usage: /end-review [return|summarize|fix]", "error");
      return undefined;
    }
    return ctx.ui
      .select("Finish review:", [
        "Return only",
        "Return and summarize",
        "Return and fix findings",
      ])
      .then((choice: string | undefined) => {
        if (choice === "Return and summarize") return "summarize";
        if (choice === "Return and fix findings") return "fix";
        if (choice === "Return only") return "return";
        return undefined;
      });
  }

  private async endReview(
    rawArgs: string,
    ctx: ExtensionCommandContext,
  ): Promise<void> {
    if (this.endInProgress) {
      notify(ctx, "/end-review is already running", "info");
      return;
    }
    const state = this.activeState;
    if (!state) {
      notify(ctx, "No review is active", "info");
      return;
    }

    const action = await this.parseEndAction(rawArgs, ctx);
    if (!action) {
      return;
    }

    this.endInProgress = true;
    try {
      let repositoryRestored = true;
      await ctx.waitForIdle();
      if (state.conversationOriginId) {
        const result = await ctx.navigateTree(state.conversationOriginId, {
          summarize: action !== "return",
          customInstructions: action !== "return"
            ? REVIEW_SUMMARY_PROMPT
            : undefined,
          replaceInstructions: action !== "return",
        });
        if (result.cancelled) {
          notify(ctx, "Review return was cancelled", "info");
          return;
        }
      }

      this.clearState(ctx);
      if (state.restore) {
        if (action === "fix") {
          const reviewChangeId = await currentChangeId(
            this.pi,
            state.restore.repoRoot,
          );
          this.pi.appendEntry(
            REVIEW_RESTORE_TYPE,
            {
              ...state.restore,
              pending: true,
              reviewChangeId,
            } satisfies PendingRestoreState,
          );
          notify(
            ctx,
            "Leaving the working copy on the PR fix change; use /review-restore when finished",
            "info",
          );
        } else {
          repositoryRestored = await this.restoreWorkingCopy(ctx, {
            ...state.restore,
            pending: true,
          });
        }
      }

      if (action === "fix") {
        this.pi.sendUserMessage(REVIEW_FIX_PROMPT, { deliverAs: "followUp" });
      } else {
        notify(
          ctx,
          repositoryRestored
            ? action === "summarize"
              ? "Review returned and summarized"
              : "Review finished"
            : "Review conversation finished, but the working-copy restore is still pending; retry with /review-restore",
          repositoryRestored ? "info" : "warning",
        );
      }
    } finally {
      this.endInProgress = false;
    }
  }

  private async restorePendingWorkingCopy(
    ctx: ExtensionCommandContext,
  ): Promise<void> {
    if (this.activeState) {
      notify(
        ctx,
        "Finish the active review before restoring its working copy",
        "warning",
      );
      return;
    }
    await ctx.waitForIdle();
    const data = latestCustomData(ctx, REVIEW_RESTORE_TYPE, false);
    if (!isPendingRestoreState(data) || !data.pending) {
      notify(
        ctx,
        "There is no pending PR review working copy to restore",
        "info",
      );
      return;
    }
    await this.restoreWorkingCopy(ctx, data);
  }

  private async restoreWorkingCopy(
    ctx: ExtensionContext,
    restore: PendingRestoreState,
  ): Promise<boolean> {
    const reviewChangeId = restore.reviewChangeId ??
      (await currentChangeId(this.pi, restore.repoRoot));
    const result = await this.pi.exec(
      "jj",
      ["--repository", restore.repoRoot, "edit", restore.originBookmark],
      { timeout: 30_000 },
    );
    if (result.code !== 0) {
      this.pi.appendEntry(
        REVIEW_RESTORE_TYPE,
        {
          ...restore,
          pending: true,
          reviewChangeId,
        } satisfies PendingRestoreState,
      );
      notify(
        ctx,
        `Could not restore the original working copy: ${
          result.stderr.trim() || result.stdout.trim()
        }`,
        "error",
      );
      return false;
    }

    const removeAnchor = await this.pi.exec(
      "jj",
      [
        "--repository",
        restore.repoRoot,
        "bookmark",
        "delete",
        restore.originBookmark,
      ],
      { timeout: 10_000 },
    );
    this.pi.appendEntry(
      REVIEW_RESTORE_TYPE,
      {
        ...restore,
        pending: false,
        reviewChangeId,
      } satisfies PendingRestoreState,
    );
    const preserved = reviewChangeId
      ? ` PR review work remains in change ${reviewChangeId}.`
      : "";
    const anchorWarning = removeAnchor.code === 0
      ? ""
      : ` Temporary bookmark ${restore.originBookmark} could not be removed.`;
    notify(
      ctx,
      `Restored the original working-copy change ${restore.originalChangeId}.${preserved}${anchorWarning}`,
      removeAnchor.code === 0 ? "info" : "warning",
    );
    return true;
  }
}
