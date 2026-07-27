import {
  type ExtensionAPI,
  type ExtensionContext,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { applyPatch } from "./core";

const APPLY_PATCH_GRAMMAR = String.raw`start: begin_patch hunk+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?

hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "*** Add File: " filename LF add_line+
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?

filename: /(.+)/
add_line: "+" /(.*)/ LF -> line

change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
eof_line: "*** End of File" LF

%import common.LF`;

const DESCRIPTION =
  "Use the apply_patch tool to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON. Results are truncated to 2,000 lines or 50KB.";

function shouldEnable(ctx: ExtensionContext): boolean {
  return ctx.model?.provider === "openai";
}

function setEnabled(pi: ExtensionAPI, enabled: boolean): void {
  const active = pi.getActiveTools();
  const hasTool = active.includes("apply_patch");
  if (enabled === hasTool) return;

  pi.setActiveTools(
    enabled
      ? [...active, "apply_patch"]
      : active.filter((name) => name !== "apply_patch"),
  );
}

function patchPaths(input: string | undefined): string[] {
  if (!input) return [];
  return [...input.matchAll(/^\*\*\* (?:Add|Delete|Update) File: (.+)$/gm)]
    .map((match) => match[1])
    .filter((path): path is string => path !== undefined);
}

export default function applyPatchExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "apply_patch",
    label: "Apply Patch",
    description: DESCRIPTION,
    promptSnippet:
      "Apply Codex-style V4A patches to create, update, move, or delete files",
    promptGuidelines: [
      "Use apply_patch for file changes when it is active; prefer it over edit and write for multi-file or structured changes.",
      "Keep apply_patch changes small and focused, then run the relevant checks after editing.",
    ],
    parameters: Type.Object(
      {
        input: Type.String({
          description: "The entire contents of the apply_patch command",
        }),
      },
      { additionalProperties: false },
    ),
    constrainedSampling: {
      type: "grammar",
      variants: { openai_lark: APPLY_PATCH_GRAMMAR },
    },
    executionMode: "sequential",

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) throw new Error("apply_patch cancelled");
      const result = await applyPatch(
        ctx.cwd,
        params.input,
        withFileMutationQueue,
        signal,
      );
      return {
        content: [{ type: "text" as const, text: result.output }],
        details: { changes: result.changes },
      };
    },

    renderCall(args, theme, _context) {
      const paths = patchPaths(args.input);
      const suffix = paths.length > 0 ? ` ${paths.join(", ")}` : "";
      return new Text(
        theme.fg("toolTitle", theme.bold("apply_patch")) +
          theme.fg("muted", suffix),
        0,
        0,
      );
    },

    renderResult(result, _options, theme, context) {
      const text = result.content.find((block) => block.type === "text");
      return new Text(
        theme.fg(
          context.isError ? "error" : "toolOutput",
          text?.type === "text" ? text.text : "",
        ),
        0,
        0,
      );
    },
  });

  pi.on("session_start", (_event, ctx) => setEnabled(pi, shouldEnable(ctx)));
  pi.on(
    "model_select",
    (event) => setEnabled(pi, event.model.provider === "openai"),
  );
}
