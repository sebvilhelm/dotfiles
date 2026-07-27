import { realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

export const AGENTS_FILE_NAME = "AGENTS.md";
const MAX_BYTES_PER_FILE = 32 * 1024;
const encoder = new TextEncoder();

export type ContextBlock = {
  type: string;
  text?: string;
};

export type NestedAgentsFile = {
  canonicalPath: string;
  scopedPath: string;
};

export type ContainedTarget = {
  root: string;
  target: string;
};

export function normalizeReadPath(inputPath: string): string {
  return inputPath.startsWith("@") ? inputPath.slice(1) : inputPath;
}

function isDescendant(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return (
    pathFromRoot !== "" &&
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

export async function resolveContainedTarget(
  root: string,
  inputPath: string,
): Promise<ContainedTarget | undefined> {
  try {
    const canonicalRoot = await realpath(root);
    const normalizedPath = normalizeReadPath(inputPath);
    const requestedPath = isAbsolute(normalizedPath)
      ? normalizedPath
      : resolve(root, normalizedPath);
    const canonicalTarget = await realpath(requestedPath);

    if (!isDescendant(canonicalRoot, canonicalTarget)) {
      return undefined;
    }

    return { root: canonicalRoot, target: canonicalTarget };
  } catch {
    return undefined;
  }
}

export async function findNestedAgentsFiles(
  root: string,
  inputPath: string,
): Promise<NestedAgentsFile[]> {
  const contained = await resolveContainedTarget(root, inputPath);
  if (!contained) {
    return [];
  }

  const files: NestedAgentsFile[] = [];
  let currentDirectory = dirname(contained.target);

  while (currentDirectory !== contained.root) {
    const scopedPath = join(currentDirectory, AGENTS_FILE_NAME);

    try {
      const canonicalPath = await realpath(scopedPath);
      if (
        canonicalPath !== contained.target &&
        isDescendant(contained.root, canonicalPath)
      ) {
        files.push({ canonicalPath, scopedPath });
      }
    } catch {
      // Most directories do not contain an AGENTS.md file.
    }

    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      break;
    }
    currentDirectory = parentDirectory;
  }

  return files.reverse();
}

export function directAgentsPaths(root: string, inputPath: string): string[] {
  const normalizedPath = normalizeReadPath(inputPath);
  if (basename(normalizedPath) !== AGENTS_FILE_NAME) {
    return [];
  }

  const requestedPath = isAbsolute(normalizedPath)
    ? resolve(normalizedPath)
    : resolve(root, normalizedPath);
  return [requestedPath];
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function lineCount(value: string): number {
  return value.length === 0 ? 0 : value.split("\n").length;
}

function truncateUtf8(
  value: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= maxBytes) {
    return { text: value, truncated: false };
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let end = Math.max(0, maxBytes);
  while (end > 0) {
    try {
      return {
        text: decoder.decode(bytes.subarray(0, end)),
        truncated: true,
      };
    } catch {
      end -= 1;
    }
  }

  return { text: "", truncated: true };
}

function truncateLines(
  value: string,
  maxLines: number,
): { text: string; truncated: boolean } {
  const lines = value.split("\n");
  if (lines.length <= maxLines) {
    return { text: value, truncated: false };
  }

  return {
    text: lines.slice(0, Math.max(0, maxLines)).join("\n"),
    truncated: true,
  };
}

function safePath(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
      ? "\uFFFD"
      : character;
  }).join("");
}

function escapeAttribute(value: string): string {
  return safePath(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function textContent(blocks: readonly ContextBlock[]): string {
  return blocks
    .filter(
      (block): block is { type: "text"; text: string } =>
        block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

function formatContext(
  root: string,
  file: NestedAgentsFile,
  content: string,
  truncated: boolean,
): string {
  const displayPath = safePath(
    relative(root, file.scopedPath) || basename(file.scopedPath),
  );
  const scope = safePath(relative(root, dirname(file.scopedPath)) || ".");
  const truncationNotice = truncated
    ? "\n[AGENTS.md truncated to fit Pi's tool-output limits.]"
    : "";

  return (
    `\n\n<nested_agents_context path="${escapeAttribute(displayPath)}" scope="${
      escapeAttribute(scope)
    }">\n` +
    `These instructions apply to files under ${JSON.stringify(scope)}.\n\n` +
    `${content}${truncationNotice}\n` +
    "</nested_agents_context>"
  );
}

export class ContextAccumulator {
  private bytesRemaining: number;
  private linesRemaining: number;
  private accumulatedText = "";

  constructor(
    originalContent: readonly ContextBlock[],
    maxBytes: number,
    maxLines: number,
  ) {
    const originalText = textContent(originalContent);
    this.bytesRemaining = Math.max(0, maxBytes - byteLength(originalText));
    this.linesRemaining = Math.max(0, maxLines - lineCount(originalText));
  }

  get text(): string {
    return this.accumulatedText;
  }

  hasCapacity(root: string, file: NestedAgentsFile): boolean {
    const capacity = this.contentCapacity(root, file);
    return capacity.bytes > 0 && capacity.lines > 0;
  }

  append(root: string, file: NestedAgentsFile, content: string): boolean {
    const capacity = this.contentCapacity(root, file);
    if (capacity.bytes <= 0 || capacity.lines <= 0) {
      return false;
    }

    const byteLimited = truncateUtf8(content, capacity.bytes);
    const lineLimited = truncateLines(byteLimited.text, capacity.lines);
    const section = formatContext(
      root,
      file,
      lineLimited.text,
      byteLimited.truncated || lineLimited.truncated,
    );
    const sectionBytes = byteLength(section);
    const sectionLines = lineCount(section);

    if (
      sectionBytes > this.bytesRemaining ||
      sectionLines > this.linesRemaining
    ) {
      return false;
    }

    this.accumulatedText += section;
    this.bytesRemaining -= sectionBytes;
    this.linesRemaining -= sectionLines;
    return true;
  }

  private contentCapacity(
    root: string,
    file: NestedAgentsFile,
  ): { bytes: number; lines: number } {
    const reservedWrapper = formatContext(root, file, "", true);
    return {
      bytes: Math.min(
        MAX_BYTES_PER_FILE,
        this.bytesRemaining - byteLength(reservedWrapper),
      ),
      lines: this.linesRemaining - lineCount(reservedWrapper) + 1,
    };
  }
}
