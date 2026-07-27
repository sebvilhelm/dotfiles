import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep, win32 } from "node:path";

export type PatchOperation =
  | { type: "add"; path: string; content: string }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; movePath?: string; diff: string };

export type PatchChange = {
  status: "A" | "M" | "D";
  path: string;
};

export type ApplyPatchResult = {
  output: string;
  changes: PatchChange[];
};

export type FileMutationQueue = <T>(
  path: string,
  mutate: () => Promise<T>,
) => Promise<T>;

type FileState =
  | { exists: false }
  | { exists: true; content: string; mode: number; bom: boolean };

type Chunk = { origIndex: number; delLines: string[]; insLines: string[] };
type ParserState = { lines: string[]; index: number; fuzz: number };

const BEGIN_PATCH = "*** Begin Patch";
const END_PATCH = "*** End Patch";
const END_FILE = "*** End of File";
const OPERATION_PREFIXES = [
  "*** Add File: ",
  "*** Delete File: ",
  "*** Update File: ",
];
const END_SECTION_MARKERS = [...OPERATION_PREFIXES, END_PATCH, END_FILE];
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;
const MAX_OUTPUT_LINES = 2_000;
const MAX_OUTPUT_BYTES = 50 * 1_024;

function cancellationError(): Error {
  return new Error("apply_patch cancelled");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancellationError();
}

function fail(message: string, line?: number): never {
  const location = line === undefined ? "" : ` on line ${line}`;
  throw new Error(`apply_patch verification failed${location}: ${message}`);
}

function normalizePatchLines(input: string): string[] {
  const normalized = input.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
    .trim();
  return normalized.length === 0 ? [] : normalized.split("\n");
}

function operationHeader(line: string): boolean {
  return OPERATION_PREFIXES.some((prefix) => line.startsWith(prefix));
}

function parsePath(line: string, prefix: string, lineNumber: number): string {
  const path = line.slice(prefix.length);
  if (path.length === 0) {
    fail(`${prefix.trim()} requires a path`, lineNumber);
  }
  return path;
}

export function parsePatch(input: string): PatchOperation[] {
  const lines = normalizePatchLines(input);
  if (lines[0] !== BEGIN_PATCH) {
    fail(`patch must start with ${BEGIN_PATCH}`);
  }
  if (lines.at(-1) !== END_PATCH) {
    fail(`patch must end with ${END_PATCH}`);
  }

  const operations: PatchOperation[] = [];
  let index = 1;

  while (index < lines.length - 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    if (line.startsWith("*** Add File: ")) {
      const path = parsePath(line, "*** Add File: ", lineNumber);
      index += 1;
      const content: string[] = [];
      while (index < lines.length - 1 && !operationHeader(lines[index])) {
        const contentLine = lines[index];
        if (!contentLine.startsWith("+")) {
          fail(`invalid Add File line: ${contentLine}`, index + 1);
        }
        content.push(contentLine.slice(1));
        index += 1;
      }
      if (content.length === 0) {
        fail(`Add File for ${path} has no content`, lineNumber);
      }
      operations.push({
        type: "add",
        path,
        content: `${content.join("\n")}\n`,
      });
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      operations.push({
        type: "delete",
        path: parsePath(line, "*** Delete File: ", lineNumber),
      });
      index += 1;
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      const path = parsePath(line, "*** Update File: ", lineNumber);
      index += 1;
      let movePath: string | undefined;
      if (lines[index]?.startsWith("*** Move to: ")) {
        movePath = parsePath(lines[index], "*** Move to: ", index + 1);
        index += 1;
      }

      const diff: string[] = [];
      while (index < lines.length - 1 && !operationHeader(lines[index])) {
        diff.push(lines[index]);
        index += 1;
      }
      if (diff.length === 0) {
        fail(`Update File for ${path} has no hunks`, lineNumber);
      }
      operations.push({
        type: "update",
        path,
        movePath,
        diff: diff.join("\n"),
      });
      continue;
    }

    fail(`invalid operation header: ${line}`, lineNumber);
  }

  if (operations.length === 0) {
    fail("patch contains no file operations");
  }
  return operations;
}

function isDone(state: ParserState, prefixes: string[]): boolean {
  const line = state.lines[state.index];
  return line === undefined ||
    prefixes.some((prefix) => line.startsWith(prefix));
}

function readPrefix(state: ParserState, prefix: string): string {
  const line = state.lines[state.index];
  if (line?.startsWith(prefix)) {
    state.index += 1;
    return line.slice(prefix.length);
  }
  return "";
}

function equalsSlice(
  source: string[],
  target: string[],
  start: number,
  normalize: (value: string) => string,
): boolean {
  if (start + target.length > source.length) return false;
  return target.every(
    (line, index) => normalize(source[start + index]) === normalize(line),
  );
}

function findContextCore(
  lines: string[],
  context: string[],
  start: number,
): { newIndex: number; fuzz: number } {
  if (context.length === 0) return { newIndex: start, fuzz: 0 };

  const normalizers = [
    { normalize: (value: string) => value, fuzz: 0 },
    { normalize: (value: string) => value.trimEnd(), fuzz: 1 },
    { normalize: (value: string) => value.trim(), fuzz: 100 },
  ];
  for (const { normalize, fuzz } of normalizers) {
    for (let index = start; index < lines.length; index += 1) {
      if (equalsSlice(lines, context, index, normalize)) {
        return { newIndex: index, fuzz };
      }
    }
  }
  return { newIndex: -1, fuzz: 0 };
}

function findContext(
  lines: string[],
  context: string[],
  start: number,
  eof: boolean,
): { newIndex: number; fuzz: number } {
  if (!eof) return findContextCore(lines, context, start);

  const atEnd = findContextCore(
    lines,
    context,
    Math.max(0, lines.length - context.length),
  );
  if (atEnd.newIndex !== -1) return atEnd;

  const fallback = findContextCore(lines, context, start);
  return { newIndex: fallback.newIndex, fuzz: fallback.fuzz + 10_000 };
}

function advanceToAnchor(
  anchor: string,
  inputLines: string[],
  cursor: number,
  parser: ParserState,
): number {
  const exact = inputLines.indexOf(anchor, cursor);
  if (exact !== -1) return exact + 1;

  const trimmedAnchor = anchor.trim();
  const fuzzy = inputLines.findIndex(
    (line, index) => index >= cursor && line.trim() === trimmedAnchor,
  );
  if (fuzzy !== -1) {
    parser.fuzz += 1;
    return fuzzy + 1;
  }
  return cursor;
}

function readSection(
  lines: string[],
  startIndex: number,
): {
  context: string[];
  chunks: Chunk[];
  endIndex: number;
  eof: boolean;
} {
  const context: string[] = [];
  const chunks: Chunk[] = [];
  let deleted: string[] = [];
  let inserted: string[] = [];
  let mode: "keep" | "add" | "delete" = "keep";
  let index = startIndex;

  const flush = (): void => {
    if (deleted.length === 0 && inserted.length === 0) return;
    chunks.push({
      origIndex: context.length - deleted.length,
      delLines: deleted,
      insLines: inserted,
    });
    deleted = [];
    inserted = [];
  };

  while (index < lines.length) {
    const raw = lines[index];
    if (
      raw.startsWith("@@") ||
      raw === END_FILE ||
      END_SECTION_MARKERS.some((prefix) => raw.startsWith(prefix))
    ) {
      break;
    }
    if (raw.startsWith("***")) fail(`invalid hunk line: ${raw}`);

    const line = raw === "" ? " " : raw;
    const previousMode = mode;
    if (line[0] === "+") mode = "add";
    else if (line[0] === "-") mode = "delete";
    else if (line[0] === " ") mode = "keep";
    else fail(`invalid hunk line: ${line}`);

    const text = line.slice(1);
    if (mode === "keep" && previousMode !== "keep") flush();
    if (mode === "delete") {
      deleted.push(text);
      context.push(text);
    } else if (mode === "add") {
      inserted.push(text);
    } else {
      context.push(text);
    }
    index += 1;
  }
  flush();

  if (index === startIndex) {
    fail(`empty update hunk near ${lines[index] ?? "end of patch"}`);
  }
  const eof = lines[index] === END_FILE;
  return { context, chunks, endIndex: eof ? index + 1 : index, eof };
}

export function applyDiff(input: string, diff: string): string {
  const diffLines = diff
    .split(/\r?\n/)
    .map((line) => line.replace(/\r$/, ""))
    .filter((line, index, lines) =>
      !(index === lines.length - 1 && line === "")
    );
  const parser: ParserState = {
    lines: [...diffLines, END_PATCH],
    index: 0,
    fuzz: 0,
  };
  const sourceLines = input.split("\n").map((line, index, lines) => {
    const hasEnding = index < lines.length - 1;
    const hasCarriageReturn = hasEnding && line.endsWith("\r");
    return {
      text: hasCarriageReturn ? line.slice(0, -1) : line,
      ending: hasEnding ? (hasCarriageReturn ? "\r\n" : "\n") : "",
    };
  });
  const inputLines = sourceLines.map((line) => line.text);
  const preferredEnding = sourceLines.find((line) => line.ending)?.ending ??
    "\n";
  const chunks: Chunk[] = [];
  let cursor = 0;

  while (!isDone(parser, END_SECTION_MARKERS)) {
    const anchor = readPrefix(parser, "@@ ");
    const bareAnchor = anchor.length === 0 &&
      parser.lines[parser.index] === "@@";
    if (bareAnchor) parser.index += 1;
    if (!(anchor || bareAnchor || cursor === 0)) {
      fail(`invalid update line: ${parser.lines[parser.index]}`);
    }
    if (anchor.trim()) {
      cursor = advanceToAnchor(anchor, inputLines, cursor, parser);
    }

    const section = readSection(parser.lines, parser.index);
    const match = findContext(inputLines, section.context, cursor, section.eof);
    if (match.newIndex === -1) {
      const kind = section.eof ? "EOF context" : "context";
      fail(`could not find ${kind}:\n${section.context.join("\n")}`);
    }
    parser.fuzz += match.fuzz;
    chunks.push(
      ...section.chunks.map((chunk) => ({
        ...chunk,
        origIndex: chunk.origIndex + match.newIndex,
      })),
    );
    cursor = match.newIndex + section.context.length;
    parser.index = section.endIndex;
  }

  const output: Array<{ text: string; ending: string }> = [];
  let inputIndex = 0;
  for (const chunk of chunks) {
    if (inputIndex > chunk.origIndex) {
      fail(`overlapping update hunk at input line ${chunk.origIndex + 1}`);
    }
    output.push(...sourceLines.slice(inputIndex, chunk.origIndex));
    output.push(...chunk.insLines.map((text) => ({ text, ending: "" })));
    inputIndex = chunk.origIndex + chunk.delLines.length;
  }
  output.push(...sourceLines.slice(inputIndex));
  return output.map((line, index) => {
    const needsEnding = index < output.length - 1;
    return line.text +
      (needsEnding ? line.ending || preferredEnding : line.ending);
  }).join("");
}

function validateRelativePath(path: string): void {
  if (
    path.includes("\0") ||
    isAbsolute(path) ||
    win32.isAbsolute(path) ||
    path.split(/[\\/]/).some((part) => part === "..")
  ) {
    fail(`path must stay relative to the working directory: ${path}`);
  }
}

function resolvePatchPath(root: string, path: string): string {
  validateRelativePath(path);
  const target = resolve(root, path);
  const fromRoot = relative(root, target);
  if (
    fromRoot === "" ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    fail(`path must name a file inside the working directory: ${path}`);
  }
  return target;
}

async function readState(
  root: string,
  path: string,
  signal?: AbortSignal,
): Promise<FileState> {
  throwIfAborted(signal);
  const target = resolvePatchPath(root, path);
  const fromRoot = relative(root, target);
  const parts = fromRoot.split(/[\\/]/).filter(Boolean);
  let current = root;

  for (let index = 0; index < parts.length; index += 1) {
    current = resolve(current, parts[index]);
    try {
      const metadata = await lstat(current);
      throwIfAborted(signal);
      if (metadata.isSymbolicLink()) {
        fail(`symbolic links are not valid patch targets: ${path}`);
      }
      if (index < parts.length - 1 && !metadata.isDirectory()) {
        fail(`parent path is not a directory: ${path}`);
      }
      if (index === parts.length - 1) {
        if (!metadata.isFile()) {
          fail(`patch target is not a regular file: ${path}`);
        }
        const bytes = await readFile(current);
        throwIfAborted(signal);
        const bom = UTF8_BOM.every((byte, offset) => bytes[offset] === byte);
        let content: string;
        try {
          content = UTF8_DECODER.decode(bom ? bytes.subarray(3) : bytes);
        } catch {
          fail(`patch target is not valid UTF-8 text: ${path}`);
        }
        return { exists: true, content, mode: metadata.mode, bom };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { exists: false };
      }
      throw error;
    }
  }
  return { exists: false };
}

function cloneState(state: FileState): FileState {
  return state.exists ? { ...state } : { exists: false };
}

async function writeState(path: string, state: FileState & { exists: true }) {
  await mkdir(dirname(path), { recursive: true });
  const content = state.bom ? `\uFEFF${state.content}` : state.content;
  await writeFile(path, content, { mode: state.mode });
  await chmod(path, state.mode);
}

export function formatPatchOutput(changes: PatchChange[]): string {
  const header = "Success. Updated the following files:";
  const changeLines = changes.map((change) =>
    `${change.status} ${change.path}`
  );
  const complete = [header, ...changeLines].join("\n");
  if (
    changeLines.length + 1 <= MAX_OUTPUT_LINES &&
    new TextEncoder().encode(complete).byteLength <= MAX_OUTPUT_BYTES
  ) {
    return complete;
  }

  const shown: string[] = [];
  for (const line of changeLines.slice(0, MAX_OUTPUT_LINES - 2)) {
    const nextCount = shown.length + 1;
    const notice =
      `[Output truncated: showing ${nextCount} of ${changes.length} file changes.]`;
    const candidate = [header, ...shown, line, notice].join("\n");
    if (new TextEncoder().encode(candidate).byteLength > MAX_OUTPUT_BYTES) {
      break;
    }
    shown.push(line);
  }
  const notice =
    `[Output truncated: showing ${shown.length} of ${changes.length} file changes.]`;
  return [header, ...shown, notice].join("\n");
}

async function applyOperations(
  root: string,
  operations: PatchOperation[],
  signal?: AbortSignal,
): Promise<ApplyPatchResult> {
  const initial = new Map<string, FileState>();
  const staged = new Map<string, FileState>();
  const changes: PatchChange[] = [];

  const getState = async (
    path: string,
  ): Promise<{ key: string; state: FileState }> => {
    throwIfAborted(signal);
    const key = resolvePatchPath(root, path);
    let state = staged.get(key);
    if (!state) {
      state = await readState(root, path, signal);
      initial.set(key, cloneState(state));
      staged.set(key, state);
    }
    return { key, state };
  };

  for (const operation of operations) {
    throwIfAborted(signal);
    if (operation.type === "add") {
      const { key, state } = await getState(operation.path);
      if (state.exists) {
        fail(`Add File target already exists: ${operation.path}`);
      }
      staged.set(key, {
        exists: true,
        content: operation.content,
        mode: 0o666 & ~process.umask(),
        bom: false,
      });
      changes.push({ status: "A", path: operation.path });
      continue;
    }

    if (operation.type === "delete") {
      const { key, state } = await getState(operation.path);
      if (!state.exists) {
        fail(`Delete File target does not exist: ${operation.path}`);
      }
      staged.set(key, { exists: false });
      changes.push({ status: "D", path: operation.path });
      continue;
    }

    const source = await getState(operation.path);
    if (!source.state.exists) {
      fail(`Update File target does not exist: ${operation.path}`);
    }
    const content = applyDiff(source.state.content, operation.diff);
    if (operation.movePath) {
      const destination = await getState(operation.movePath);
      if (destination.state.exists) {
        fail(`Move destination already exists: ${operation.movePath}`);
      }
      staged.set(source.key, { exists: false });
      staged.set(destination.key, {
        exists: true,
        content,
        mode: source.state.mode,
        bom: source.state.bom,
      });
      changes.push({ status: "M", path: operation.movePath });
    } else {
      staged.set(source.key, { ...source.state, content });
      changes.push({ status: "M", path: operation.path });
    }
  }

  throwIfAborted(signal);
  const touched = [...staged.keys()];
  try {
    for (const key of touched) {
      const state = staged.get(key)!;
      if (!state.exists) continue;
      throwIfAborted(signal);
      await writeState(key, state);
      throwIfAborted(signal);
    }
    for (const key of touched) {
      if (staged.get(key)!.exists) continue;
      throwIfAborted(signal);
      await rm(key, { force: true });
      throwIfAborted(signal);
    }
  } catch (error) {
    for (const [key, state] of initial) {
      try {
        if (state.exists) await writeState(key, state);
        else await rm(key, { force: true });
      } catch {
        // Preserve the original failure; rollback is best-effort.
      }
    }
    throw error;
  }

  const grouped = (["A", "M", "D"] as const).flatMap((status) =>
    changes.filter((change) => change.status === status)
  );
  return { output: formatPatchOutput(grouped), changes: grouped };
}

function withQueues<T>(
  paths: string[],
  queue: FileMutationQueue | undefined,
  signal: AbortSignal | undefined,
  mutate: () => Promise<T>,
): Promise<T> {
  throwIfAborted(signal);
  if (!queue || paths.length === 0) return mutate();
  const [path, ...rest] = paths;
  return queue(path, () => withQueues(rest, queue, signal, mutate));
}

function returnWithoutWaitingOnCancelledQueue<T>(
  queued: Promise<T>,
  signal: AbortSignal | undefined,
  mutationStarted: () => boolean,
): Promise<T> {
  if (!signal) return queued;
  return new Promise<T>((resolvePromise, rejectPromise) => {
    let settled = false;
    const settle = (settlePromise: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      settlePromise();
    };
    const onAbort = (): void => {
      if (!mutationStarted()) {
        settle(() => rejectPromise(cancellationError()));
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    queued.then(
      (result) => settle(() => resolvePromise(result)),
      (error) => settle(() => rejectPromise(error)),
    );
  });
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR");
}

async function canonicalMutationPath(
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  try {
    const canonical = await realpath(path);
    throwIfAborted(signal);
    return canonical;
  } catch (error) {
    if (isMissingPathError(error)) return path;
    throw error;
  }
}

export async function applyPatch(
  cwd: string,
  input: string,
  queue?: FileMutationQueue,
  signal?: AbortSignal,
): Promise<ApplyPatchResult> {
  throwIfAborted(signal);
  const root = await realpath(cwd);
  throwIfAborted(signal);
  const operations = parsePatch(input);
  const paths = operations.flatMap((operation) =>
    operation.type === "update" && operation.movePath
      ? [operation.path, operation.movePath]
      : [operation.path]
  );
  const canonicalTargets: string[] = [];
  for (const path of paths) {
    const target = resolvePatchPath(root, path);
    canonicalTargets.push(await canonicalMutationPath(target, signal));
  }
  const targets = [...new Set(canonicalTargets)].sort();
  let mutationStarted = false;
  const queued = withQueues(targets, queue, signal, () => {
    mutationStarted = true;
    return applyOperations(root, operations, signal);
  });
  return returnWithoutWaitingOnCancelledQueue(
    queued,
    signal,
    () => mutationStarted,
  );
}
