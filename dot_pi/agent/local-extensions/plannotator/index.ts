// Pi requires async command handlers, but browser reviews must not be awaited.
// deno-lint-ignore-file require-await

import { spawn } from "node:child_process";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { feedbackMessage, latestAssistantText } from "./core.ts";

function notify(
  ctx: ExtensionCommandContext,
  message: string,
  type: "info" | "warning" | "error" = "info",
): void {
  ctx.ui.notify(message, type);
}

function runPlannotator(
  args: string[],
  cwd: string,
  signal: AbortSignal,
  input?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("plannotator", args, {
      cwd,
      signal,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => stdout += chunk);
    child.stderr.on("data", (chunk: string) => stderr += chunk);
    child.once("error", reject);
    child.stdin.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const details = stderr.trim() || stdout.trim() ||
        "No details from Plannotator";
      reject(
        new Error(
          `Plannotator exited ${
            code === null ? `from ${signal}` : `with code ${code}`
          }: ${details}`,
        ),
      );
    });
    child.stdin.end(input);
  });
}

function deliverFeedback(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  label: string,
  output: string,
): void {
  const message = feedbackMessage(label, output);
  if (!message) {
    notify(ctx, "Plannotator closed without returning feedback.");
    return;
  }

  pi.sendUserMessage(message, { deliverAs: "followUp" });
  notify(ctx, "Plannotator feedback sent to this Pi session.");
}

function reportError(ctx: ExtensionCommandContext, error: unknown): void {
  notify(
    ctx,
    error instanceof Error ? error.message : String(error),
    "error",
  );
}

function requireIdle(ctx: ExtensionCommandContext): boolean {
  if (ctx.isIdle()) return true;
  notify(
    ctx,
    "Wait until Pi is idle before starting a Plannotator review.",
    "warning",
  );
  return false;
}

function quotedArgument(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export default function plannotatorExtension(pi: ExtensionAPI): void {
  const active = new Set<AbortController>();

  function start(
    ctx: ExtensionCommandContext,
    label: string,
    args: string[],
    input?: string,
  ): void {
    const controller = new AbortController();
    active.add(controller);
    ctx.ui.setStatus("plannotator", "Plannotator: reviewing in browser");
    notify(
      ctx,
      "Plannotator started. You can keep prompting while the review is open.",
    );

    // Pi awaits command handlers in its prompt loop. Never await the browser
    // review here, or an open/abandoned review blocks all subsequent prompts.
    void runPlannotator(args, ctx.cwd, controller.signal, input)
      .then((output) => {
        if (active.has(controller)) deliverFeedback(pi, ctx, label, output);
      })
      .catch((error: unknown) => {
        if (active.has(controller)) reportError(ctx, error);
      })
      .finally(() => {
        if (!active.delete(controller)) return;
        if (active.size === 0) ctx.ui.setStatus("plannotator", undefined);
      });
  }

  pi.on("session_shutdown", (_event, ctx) => {
    const controllers = [...active];
    active.clear();
    for (const controller of controllers) controller.abort();
    ctx.ui.setStatus("plannotator", undefined);
  });

  pi.registerCommand("plannotator-review", {
    description: "Review current code changes with Plannotator",
    handler: async (args, ctx) => {
      if (!requireIdle(ctx)) return;
      const target = args.trim();
      start(ctx, "code review", target ? ["review", target] : ["review"]);
    },
  });

  pi.registerCommand("plannotator-last", {
    description: "Annotate the latest assistant message with Plannotator",
    handler: async (_args, ctx) => {
      if (!requireIdle(ctx)) return;
      const message = latestAssistantText(ctx.sessionManager.getBranch());
      if (!message) {
        notify(
          ctx,
          "No assistant message with text was found on this session branch.",
          "warning",
        );
        return;
      }

      start(ctx, "last message", ["annotate-last", "--stdin"], message);
    },
  });

  pi.registerCommand("plannotator-annotate", {
    description: "Annotate a file or folder with Plannotator",
    handler: async (args, ctx) => {
      if (!requireIdle(ctx)) return;
      const path = quotedArgument(args);
      if (!path) {
        notify(ctx, "Usage: /plannotator-annotate <file-or-folder>", "warning");
        return;
      }

      start(ctx, `annotation of ${path}`, ["annotate", path]);
    },
  });
}
