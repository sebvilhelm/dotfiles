import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type ExtensionAPI,
  isReadToolResult,
} from "@earendil-works/pi-coding-agent";
import {
  AGENTS_FILE_NAME,
  ContextAccumulator,
  directAgentsPaths,
  findNestedAgentsFiles,
  type NestedAgentsFile,
  normalizeReadPath,
  resolveContainedTarget,
} from "./core";

function isInjected(
  injected: ReadonlySet<string>,
  file: NestedAgentsFile,
): boolean {
  return injected.has(file.canonicalPath) || injected.has(file.scopedPath);
}

function reserve(injected: Set<string>, file: NestedAgentsFile): void {
  injected.add(file.canonicalPath);
  injected.add(file.scopedPath);
}

function release(injected: Set<string>, file: NestedAgentsFile): void {
  injected.delete(file.canonicalPath);
  injected.delete(file.scopedPath);
}

export default function nestedAgentsExtension(pi: ExtensionAPI): void {
  const injected = new Set<string>();

  const reset = (): void => {
    injected.clear();
  };

  pi.on("session_start", reset);

  pi.on("tool_result", async (event, ctx) => {
    if (
      event.isError ||
      !isReadToolResult(event) ||
      !event.content.some((block) => block.type === "text")
    ) {
      return;
    }

    const inputPath = event.input.path;
    if (typeof inputPath !== "string") {
      return;
    }

    const contained = await resolveContainedTarget(ctx.cwd, inputPath);
    if (!contained) {
      return;
    }

    const normalizedPath = normalizeReadPath(inputPath);
    if (basename(normalizedPath) === AGENTS_FILE_NAME) {
      for (const path of directAgentsPaths(ctx.cwd, inputPath)) {
        injected.add(path);
      }
      injected.add(contained.target);
    }

    const files = (await findNestedAgentsFiles(ctx.cwd, inputPath)).filter(
      (file) => !isInjected(injected, file),
    );
    if (files.length === 0) {
      return;
    }

    const root = contained.root;
    const context = new ContextAccumulator(
      event.content,
      DEFAULT_MAX_BYTES,
      DEFAULT_MAX_LINES,
    );

    for (const file of files) {
      if (isInjected(injected, file)) {
        continue;
      }
      if (!context.hasCapacity(root, file)) {
        break;
      }

      // Reserve before reading so concurrent tool results cannot inject it twice.
      reserve(injected, file);

      let content: string;
      try {
        content = await readFile(file.canonicalPath, "utf8");
      } catch {
        release(injected, file);
        continue;
      }

      if (!context.append(root, file, content)) {
        release(injected, file);
        break;
      }
    }

    if (context.text.length === 0) {
      return;
    }

    return {
      content: [
        ...event.content,
        { type: "text" as const, text: context.text },
      ],
    };
  });

  pi.on("session_compact", reset);
  pi.on("session_tree", reset);
  pi.on("session_shutdown", reset);
}
