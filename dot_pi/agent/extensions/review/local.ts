import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  type LocalTargetSpec,
  parseLocalArguments,
  shellQuote,
} from "./core.ts";
import { notify, type ReviewRequest, ReviewWorkflow } from "./workflow.ts";

const TRUNK_LABEL = "Diff from trunk() to @";
const WORKING_COPY_LABEL = "Current working-copy change (@)";
const CUSTOM_REVSET_LABEL = "Custom revset";

type LocalTarget = {
  label: string;
  scope: string;
  commands: string[];
  validationArgs: string[];
};

async function resolveJjRoot(
  pi: ExtensionAPI,
  cwd: string,
): Promise<string | undefined> {
  const result = await pi.exec("jj", ["root"], { cwd, timeout: 5_000 });
  return result.code === 0 ? result.stdout.trim() || undefined : undefined;
}

function buildTarget(spec: LocalTargetSpec): LocalTarget {
  switch (spec.type) {
    case "trunk":
      return {
        label: TRUNK_LABEL,
        scope:
          "All changes from the repository trunk through the current working copy.",
        commands: [
          `jj --no-pager diff --from ${shellQuote("trunk()")}` +
          " --to @ --summary",
          `jj --no-pager diff --from ${shellQuote("trunk()")}` +
          " --to @ --git",
        ],
        validationArgs: ["diff", "--from", "trunk()", "--to", "@", "--summary"],
      };
    case "working-copy":
      return {
        label: WORKING_COPY_LABEL,
        scope: "Only the current working-copy change relative to its parent.",
        commands: [
          `jj --no-pager diff -r ${shellQuote("@")} --summary`,
          `jj --no-pager diff -r ${shellQuote("@")} --git`,
        ],
        validationArgs: ["diff", "-r", "@", "--summary"],
      };
    case "revset":
      return {
        label: `Revset: ${spec.revset}`,
        scope: `The diff represented by the Jujutsu revset ${spec.revset}.`,
        commands: [
          `jj --no-pager diff -r ${shellQuote(spec.revset)} --summary`,
          `jj --no-pager diff -r ${shellQuote(spec.revset)} --git`,
        ],
        validationArgs: ["diff", "-r", spec.revset, "--summary"],
      };
  }
}

async function promptForTarget(
  ctx: ExtensionCommandContext,
): Promise<LocalTargetSpec | undefined> {
  const choice = await ctx.ui.select("Review what?", [
    TRUNK_LABEL,
    WORKING_COPY_LABEL,
    CUSTOM_REVSET_LABEL,
  ]);
  if (choice === TRUNK_LABEL) {
    return { type: "trunk" };
  }
  if (choice === WORKING_COPY_LABEL) {
    return { type: "working-copy" };
  }
  if (choice !== CUSTOM_REVSET_LABEL) {
    return undefined;
  }

  const revset = await ctx.ui.input(
    "Jujutsu revset to review",
    "e.g. trunk()..@, @-, bookmarks(exact:foo)",
  );
  if (!revset?.trim()) {
    return undefined;
  }
  return { type: "revset", revset: revset.trim() };
}

export function registerLocalReview(
  pi: ExtensionAPI,
  workflow: ReviewWorkflow,
): void {
  const handler = async (
    rawArgs: string,
    ctx: ExtensionCommandContext,
  ): Promise<void> => {
    if (workflow.isActive()) {
      notify(ctx, "Finish the active review with /end-review first", "warning");
      return;
    }

    const parsed = parseLocalArguments(rawArgs);
    if (parsed.error) {
      notify(ctx, parsed.error, "error");
      return;
    }

    let targetSpec = parsed.target;
    if (!targetSpec) {
      if (!ctx.hasUI) {
        notify(
          ctx,
          "Usage: /review-local <trunk|wc|revset <expr>> [--focus <text>]",
          "error",
        );
        return;
      }
      targetSpec = await promptForTarget(ctx);
      if (!targetSpec) {
        return;
      }
    }

    const isolate = await workflow.chooseIsolation(ctx, parsed.isolation);
    if (isolate === undefined) {
      return;
    }
    if (!ctx.isIdle()) {
      notify(
        ctx,
        "Waiting for the agent to become idle before preparing the review",
        "info",
      );
    }
    await ctx.waitForIdle();

    const repoRoot = await resolveJjRoot(pi, ctx.cwd);
    if (!repoRoot) {
      notify(
        ctx,
        "Current directory is not inside a Jujutsu repository",
        "error",
      );
      return;
    }

    const target = buildTarget(targetSpec);
    const validation = await pi.exec(
      "jj",
      ["--repository", repoRoot, "--no-pager", ...target.validationArgs],
      { timeout: 30_000 },
    );
    if (validation.code !== 0) {
      notify(
        ctx,
        `Invalid review target: ${
          validation.stderr.trim() || validation.stdout.trim()
        }`,
        "error",
      );
      return;
    }

    const request: ReviewRequest = {
      kind: "local",
      repoRoot,
      label: target.label,
      scope: target.scope,
      commands: target.commands,
      focus: parsed.focus,
      isolate,
    };
    await workflow.start(ctx, request);
  };

  pi.registerCommand("review-local", {
    description: "Review a local Jujutsu diff or revset",
    getArgumentCompletions: (prefix: string) => {
      const values = [
        "trunk",
        "wc",
        "revset ",
        "--focus ",
        "--isolated",
        "--current-session",
      ];
      const matches = values.filter((value) => value.startsWith(prefix)).map((
        value,
      ) => ({ value, label: value }));
      return matches.length ? matches : null;
    },
    handler,
  });
}
