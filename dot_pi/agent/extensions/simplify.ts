import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

type ChangedFileStatus = "modified" | "added" | "renamed" | "copied";

type ChangedFile = {
  path: string;
  status: ChangedFileStatus;
};

type DiffScope =
  | { kind: "revision"; revision: string }
  | { kind: "from"; revision: string };

type SimplifyOptions = {
  files: string[];
  scope: DiffScope;
};

type ParsedArgs =
  | { ok: true; options: SimplifyOptions }
  | { ok: false; error: string };

type RepoResolution = { ok: true; root: string } | { ok: false; error: string };

type ChangedFilesResult =
  | { ok: true; files: ChangedFile[]; scopeDescription: string }
  | { ok: false; error: string };

type DiffResult =
  | { ok: true; files: ChangedFile[] }
  | { ok: false; error: string };

const COMMAND_NAME = "simplify";
const DIFF_TEMPLATE = 'status ++ "\\0" ++ path ++ "\\0"';
const FALLBACK_SCOPE: DiffScope = { kind: "revision", revision: "@-" };
const SCOPE_OPTIONS = [
  { prefix: "--revision=", kind: "revision" },
  { prefix: "--revset=", kind: "revision" },
  { prefix: "--from=", kind: "from" },
  { prefix: "--ref=", kind: "from" },
] as const;

function notify(
  ctx: ExtensionCommandContext,
  message: string,
  level: "info" | "warning" | "error"
): void {
  if (ctx.hasUI) {
    ctx.ui.notify(message, level);
    return;
  }

  const writer = level === "error" ? console.error : console.log;
  writer(message);
}

function parseArgs(args: string): ParsedArgs {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const files: string[] = [];
  let scope: DiffScope | undefined;

  for (const token of tokens) {
    const scopeOption = SCOPE_OPTIONS.find(({ prefix }) =>
      token.startsWith(prefix)
    );
    if (scopeOption) {
      if (scope) {
        return {
          ok: false,
          error:
            "simplify: pass only one of --revision, --revset, --from, or --ref",
        };
      }

      const revision = token.slice(scopeOption.prefix.length);
      if (!revision) {
        return {
          ok: false,
          error: `simplify: ${scopeOption.prefix.slice(0, -1)} cannot be empty`,
        };
      }

      scope = { kind: scopeOption.kind, revision };
      continue;
    }

    if (token.startsWith("--")) {
      return { ok: false, error: `simplify: unknown option ${token}` };
    }

    files.push(token);
  }

  return {
    ok: true,
    options: { files, scope: scope ?? { kind: "revision", revision: "@" } },
  };
}

async function resolveJjRepo(
  pi: ExtensionAPI,
  cwd: string
): Promise<RepoResolution> {
  const result = await pi.exec("jj", ["root"], { cwd, timeout: 5_000 });
  if (result.code !== 0) {
    const detail = result.stderr.trim();
    return {
      ok: false,
      error: detail
        ? `simplify: failed to resolve jj repository root: ${detail}`
        : "simplify: current directory is not inside a jj repository",
    };
  }

  const root = result.stdout.trim();
  return root
    ? { ok: true, root }
    : { ok: false, error: "simplify: jj returned an empty repository root" };
}

function parseDiffOutput(stdout: string): ChangedFile[] {
  const fields = stdout.split("\0");
  const files: ChangedFile[] = [];

  for (let index = 0; index + 1 < fields.length; index += 2) {
    const status = fields[index];
    const path = fields[index + 1];
    if (
      path &&
      (status === "modified" ||
        status === "added" ||
        status === "renamed" ||
        status === "copied")
    ) {
      files.push({ path, status });
    }
  }

  return files;
}

function buildDiffArgs(scope: DiffScope): string[] {
  const args = [
    "--no-pager",
    "--color=never",
    "diff",
    "--template",
    DIFF_TEMPLATE,
  ];

  if (scope.kind === "revision") {
    return [...args, "--revisions", scope.revision];
  }

  return [...args, "--from", scope.revision, "--to", "@"];
}

function describeScope(scope: DiffScope): string {
  return scope.kind === "revision"
    ? `jj revision ${scope.revision}`
    : `changes from ${scope.revision} to @`;
}

async function readDiff(
  pi: ExtensionAPI,
  root: string,
  scope: DiffScope,
  failureDescription: string
): Promise<DiffResult> {
  const result = await pi.exec("jj", buildDiffArgs(scope), {
    cwd: root,
    timeout: 15_000,
  });
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    return {
      ok: false,
      error: detail
        ? `simplify: ${failureDescription}: ${detail}`
        : `simplify: ${failureDescription}`,
    };
  }

  return { ok: true, files: parseDiffOutput(result.stdout) };
}

async function getChangedFiles(
  pi: ExtensionAPI,
  root: string,
  options: SimplifyOptions
): Promise<ChangedFilesResult> {
  if (options.files.length > 0) {
    return {
      ok: true,
      files: options.files.map((path) => ({ path, status: "modified" })),
      scopeDescription: "explicitly selected files",
    };
  }

  const diff = await readDiff(pi, root, options.scope, "jj diff failed");
  if (!diff.ok) {
    return diff;
  }

  const { files } = diff;
  if (
    files.length > 0 ||
    options.scope.kind !== "revision" ||
    options.scope.revision !== "@"
  ) {
    return {
      ok: true,
      files,
      scopeDescription: describeScope(options.scope),
    };
  }

  const fallback = await readDiff(
    pi,
    root,
    FALLBACK_SCOPE,
    "jj diff fallback failed"
  );
  if (!fallback.ok) {
    return fallback;
  }

  return {
    ok: true,
    files: fallback.files,
    scopeDescription: describeScope(FALLBACK_SCOPE),
  };
}

function buildSimplifyPrompt(
  repositoryRoot: string,
  scopeDescription: string,
  files: readonly ChangedFile[]
): string {
  const fileList = files
    .map((file) => `- ${file.path} (${file.status})`)
    .join("\n");

  return `Review the following recently changed files and apply simplification improvements.

Repository root: ${repositoryRoot}
Change scope: ${scopeDescription}
All listed paths are relative to the repository root.
Use Jujutsu commands, not git.

## Principles

- **Preserve functionality**: Never change what the code does. All existing tests must continue to pass.
- **Apply project standards**: Follow all applicable project instructions, including AGENTS.md and CLAUDE.md files.
- **Enhance clarity**: Reduce unnecessary complexity and nesting, eliminate redundant code and abstractions, improve variable and function names, consolidate related logic, and remove comments that merely restate obvious code. Avoid nested ternary operators; prefer switch statements or if/else chains for multiple conditions.
- **Maintain balance**: Do not over-simplify. Avoid clever solutions that are hard to understand, combining too many concerns into one function, or removing helpful abstractions. Prioritize readability over fewer lines.

## Scope

Only review and modify these files:
${fileList}

## Process

1. Read each file listed above from the repository root.
2. Identify concrete improvements such as dead code, unclear names, redundant logic, and inconsistent patterns.
3. Apply changes one file at a time.
4. Run the relevant formatters, linters, typecheckers, and tests after making changes.
5. Review the final change with jj diff and summarize what changed and why.

Do not add features, change public APIs, modify files outside the list, or use git commands.`;
}

async function handleSimplifyCommand(
  args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI
): Promise<void> {
  const parsed = parseArgs(args);
  if (!parsed.ok) {
    notify(ctx, parsed.error, "warning");
    return;
  }

  const repo = await resolveJjRepo(pi, ctx.cwd);
  if (!repo.ok) {
    notify(ctx, repo.error, "error");
    return;
  }

  const changed = await getChangedFiles(pi, repo.root, parsed.options);
  if (!changed.ok) {
    notify(ctx, changed.error, "error");
    return;
  }

  if (changed.files.length === 0) {
    notify(
      ctx,
      "No changed files found. Specify file paths or select another jj revision.",
      "info"
    );
    return;
  }

  pi.sendUserMessage(
    buildSimplifyPrompt(repo.root, changed.scopeDescription, changed.files),
    { deliverAs: "followUp" }
  );
}

export default function simplifyExtension(pi: ExtensionAPI): void {
  pi.registerCommand(COMMAND_NAME, {
    description:
      "Review jj changes for clarity, consistency, and maintainability improvements",
    handler: (args, ctx) => handleSimplifyCommand(args, ctx, pi),
  });
}
