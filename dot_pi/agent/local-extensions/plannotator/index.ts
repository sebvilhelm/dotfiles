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
  input?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("plannotator", args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => stdout += chunk);
    child.stderr.on("data", (chunk: string) => stderr += chunk);
    child.once("error", reject);
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

  pi.sendUserMessage(message);
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
  pi.registerCommand("plannotator-review", {
    description: "Review current code changes with Plannotator",
    handler: async (args, ctx) => {
      if (!requireIdle(ctx)) return;
      const target = args.trim();
      try {
        const output = await runPlannotator(
          target ? ["review", target] : ["review"],
          ctx.cwd,
        );
        deliverFeedback(pi, ctx, "code review", output);
      } catch (error) {
        reportError(ctx, error);
      }
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

      try {
        const output = await runPlannotator(
          ["annotate-last", "--stdin"],
          ctx.cwd,
          message,
        );
        deliverFeedback(pi, ctx, "last message", output);
      } catch (error) {
        reportError(ctx, error);
      }
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

      try {
        const output = await runPlannotator(["annotate", path], ctx.cwd);
        deliverFeedback(pi, ctx, `annotation of ${path}`, output);
      } catch (error) {
        reportError(ctx, error);
      }
    },
  });
}
