import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  normalizeGitHubRepository,
  parsePullRequestArguments,
  parsePullRequestReference,
  parseRemoteList,
  pullRequestRepository,
  remoteBookmarkRevset,
  shellQuote,
} from "./core.ts";
import {
  notify,
  type RepositoryRestoreState,
  type ReviewRequest,
  ReviewWorkflow,
} from "./workflow.ts";

type PullRequestInfo = {
  number: number;
  title: string;
  baseRefName: string;
  baseRefOid: string;
  headRefName: string;
  headRefOid: string;
  headRepository: string;
};

type RepositoryInfo = {
  nameWithOwner: string;
  url: string;
  sshUrl: string;
};

type Remote = { name: string; url: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parsePullRequestInfo(value: unknown): PullRequestInfo | undefined {
  if (!isRecord(value) || !isRecord(value.headRepository)) {
    return undefined;
  }
  const headRepository = value.headRepository.nameWithOwner;
  if (
    typeof value.number !== "number" ||
    typeof value.title !== "string" ||
    typeof value.baseRefName !== "string" ||
    typeof value.baseRefOid !== "string" ||
    typeof value.headRefName !== "string" ||
    typeof value.headRefOid !== "string" ||
    typeof headRepository !== "string"
  ) {
    return undefined;
  }
  return {
    number: value.number,
    title: value.title,
    baseRefName: value.baseRefName,
    baseRefOid: value.baseRefOid,
    headRefName: value.headRefName,
    headRefOid: value.headRefOid,
    headRepository,
  };
}

function parseRepositoryInfo(value: unknown): RepositoryInfo | undefined {
  if (
    !isRecord(value) ||
    typeof value.nameWithOwner !== "string" ||
    typeof value.url !== "string" ||
    typeof value.sshUrl !== "string"
  ) {
    return undefined;
  }
  return {
    nameWithOwner: value.nameWithOwner,
    url: value.url,
    sshUrl: value.sshUrl,
  };
}

async function resolveJjRoot(
  pi: ExtensionAPI,
  cwd: string,
): Promise<string | undefined> {
  const result = await pi.exec("jj", ["root"], { cwd, timeout: 5_000 });
  return result.code === 0 ? result.stdout.trim() || undefined : undefined;
}

async function ensureGithubCli(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<boolean> {
  const version = await pi.exec("gh", ["--version"], { timeout: 5_000 });
  if (version.code !== 0) {
    notify(
      ctx,
      "PR review requires GitHub CLI (`gh`): https://cli.github.com/",
      "error",
    );
    return false;
  }
  const auth = await pi.exec("gh", ["auth", "status"], { timeout: 15_000 });
  if (auth.code !== 0) {
    notify(
      ctx,
      "GitHub CLI is not authenticated. Run `gh auth login` and retry.",
      "error",
    );
    return false;
  }
  return true;
}

async function readPullRequest(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  repoRoot: string,
  ref: string,
): Promise<PullRequestInfo | undefined> {
  const number = parsePullRequestReference(ref);
  if (!number) {
    notify(
      ctx,
      "Invalid PR reference. Pass a positive number or a GitHub pull-request URL.",
      "error",
    );
    return undefined;
  }
  const result = await pi.exec(
    "gh",
    [
      "pr",
      "view",
      pullRequestRepository(ref) ? ref.trim() : String(number),
      "--json",
      "number,title,baseRefName,baseRefOid,headRefName,headRefOid,headRepository",
    ],
    { cwd: repoRoot, timeout: 30_000 },
  );
  if (result.code !== 0) {
    notify(
      ctx,
      `Could not fetch PR #${number}: ${
        result.stderr.trim() || result.stdout.trim()
      }`,
      "error",
    );
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    const info = parsePullRequestInfo(parsed);
    if (!info) {
      notify(ctx, "GitHub returned incomplete pull-request metadata", "error");
    }
    return info;
  } catch (error) {
    notify(
      ctx,
      `Could not parse GitHub pull-request metadata: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "error",
    );
    return undefined;
  }
}

async function readRepository(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  repoRoot: string,
): Promise<RepositoryInfo | undefined> {
  const result = await pi.exec("gh", [
    "repo",
    "view",
    "--json",
    "nameWithOwner,url,sshUrl",
  ], {
    cwd: repoRoot,
    timeout: 30_000,
  });
  if (result.code !== 0) {
    notify(
      ctx,
      `Could not identify the GitHub repository: ${
        result.stderr.trim() || result.stdout.trim()
      }`,
      "error",
    );
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    const info = parseRepositoryInfo(parsed);
    if (!info) {
      notify(ctx, "GitHub returned incomplete repository metadata", "error");
    }
    return info;
  } catch (error) {
    notify(
      ctx,
      `Could not parse GitHub repository metadata: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "error",
    );
    return undefined;
  }
}

async function listRemotes(
  pi: ExtensionAPI,
  repoRoot: string,
): Promise<Remote[] | undefined> {
  const result = await pi.exec("jj", [
    "--repository",
    repoRoot,
    "git",
    "remote",
    "list",
  ], { timeout: 10_000 });
  return result.code === 0 ? parseRemoteList(result.stdout) : undefined;
}

function preferredRepositoryUrl(repository: string, remotes: Remote[]): string {
  const useSsh = remotes.some((remote) =>
    /^(?:git@|ssh:\/\/)/i.test(remote.url)
  );
  return useSsh
    ? `git@github.com:${repository}.git`
    : `https://github.com/${repository}.git`;
}

async function ensureRemote(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  repoRoot: string,
  repository: string,
  fallbackName: string,
): Promise<string | undefined> {
  const remotes = await listRemotes(pi, repoRoot);
  if (!remotes) {
    notify(ctx, "Could not list Jujutsu Git remotes", "error");
    return undefined;
  }

  const normalizedRepository = repository.toLowerCase();
  const existing = remotes.find((remote) =>
    normalizeGitHubRepository(remote.url) === normalizedRepository
  );
  if (existing) {
    return existing.name;
  }

  const url = preferredRepositoryUrl(repository, remotes);
  const named = remotes.find((remote) => remote.name === fallbackName);
  const args = named
    ? ["--repository", repoRoot, "git", "remote", "set-url", fallbackName, url]
    : ["--repository", repoRoot, "git", "remote", "add", fallbackName, url];
  const result = await pi.exec("jj", args, { timeout: 10_000 });
  if (result.code !== 0) {
    notify(
      ctx,
      `Could not configure Jujutsu remote ${fallbackName}: ${
        result.stderr.trim() || result.stdout.trim()
      }`,
      "error",
    );
    return undefined;
  }
  return fallbackName;
}

async function fetchBookmark(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  repoRoot: string,
  remote: string,
  bookmark: string,
  expectedCommitId?: string,
): Promise<boolean> {
  const fetch = await pi.exec(
    "jj",
    [
      "--repository",
      repoRoot,
      "git",
      "fetch",
      "--remote",
      remote,
      "--branch",
      bookmark,
    ],
    { timeout: 120_000 },
  );
  if (fetch.code !== 0) {
    notify(
      ctx,
      `Could not fetch ${bookmark}@${remote}: ${
        fetch.stderr.trim() || fetch.stdout.trim()
      }`,
      "error",
    );
    return false;
  }

  if (!expectedCommitId) {
    return true;
  }

  const revision = remoteBookmarkRevset(bookmark, remote);
  const resolved = await pi.exec(
    "jj",
    [
      "--repository",
      repoRoot,
      "--no-pager",
      "log",
      "-r",
      revision,
      "--no-graph",
      "-T",
      'commit_id ++ "\\n"',
    ],
    { timeout: 10_000 },
  );
  const commitIds = resolved.stdout.trim().split(/\r?\n/).filter(Boolean);
  if (
    resolved.code !== 0 || commitIds.length !== 1 ||
    commitIds[0] !== expectedCommitId
  ) {
    notify(
      ctx,
      `Fetched ${bookmark}@${remote}, but it did not resolve to GitHub's expected commit ${expectedCommitId}`,
      "error",
    );
    return false;
  }
  return true;
}

async function resolveSingleRevisionId(
  pi: ExtensionAPI,
  repoRoot: string,
  revset: string,
  template: 'commit_id ++ "\\n"' | 'change_id ++ "\\n"',
): Promise<string | undefined> {
  const result = await pi.exec(
    "jj",
    [
      "--repository",
      repoRoot,
      "--no-pager",
      "log",
      "-r",
      revset,
      "--no-graph",
      "-T",
      template,
    ],
    { timeout: 10_000 },
  );
  if (result.code !== 0) {
    return undefined;
  }
  const ids = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  return ids.length === 1 ? ids[0] : undefined;
}

async function preparePullRequest(
  pi: ExtensionAPI,
  workflow: ReviewWorkflow,
  ctx: ExtensionCommandContext,
  repoRoot: string,
  ref: string,
  focus: string | undefined,
  isolate: boolean,
): Promise<ReviewRequest | undefined> {
  const pullRequest = await readPullRequest(pi, ctx, repoRoot, ref);
  if (!pullRequest) {
    return undefined;
  }
  const baseRepository = await readRepository(pi, ctx, repoRoot);
  if (!baseRepository) {
    return undefined;
  }
  const referencedRepository = pullRequestRepository(ref);
  if (
    referencedRepository &&
    referencedRepository !== baseRepository.nameWithOwner.toLowerCase()
  ) {
    notify(
      ctx,
      `PR URL belongs to ${referencedRepository}, but the current repository is ${baseRepository.nameWithOwner}`,
      "error",
    );
    return undefined;
  }

  const baseRemote = await ensureRemote(
    pi,
    ctx,
    repoRoot,
    baseRepository.nameWithOwner,
    "pi-review-base",
  );
  const headRemote = await ensureRemote(
    pi,
    ctx,
    repoRoot,
    pullRequest.headRepository,
    `pi-review-pr-${pullRequest.number}`,
  );
  if (!baseRemote || !headRemote) {
    return undefined;
  }

  notify(
    ctx,
    `Fetching PR #${pullRequest.number} bookmarks with Jujutsu`,
    "info",
  );
  if (
    !(await fetchBookmark(
      pi,
      ctx,
      repoRoot,
      baseRemote,
      pullRequest.baseRefName,
    )) ||
    !(await fetchBookmark(
      pi,
      ctx,
      repoRoot,
      headRemote,
      pullRequest.headRefName,
      pullRequest.headRefOid,
    ))
  ) {
    return undefined;
  }

  const forkPoint = await resolveSingleRevisionId(
    pi,
    repoRoot,
    `fork_point(${pullRequest.baseRefOid} | ${pullRequest.headRefOid})`,
    'commit_id ++ "\\n"',
  );
  if (!forkPoint) {
    notify(
      ctx,
      "Could not resolve a unique fork point between the PR base and head",
      "error",
    );
    return undefined;
  }
  const originalChangeId = await resolveSingleRevisionId(
    pi,
    repoRoot,
    "@",
    'change_id ++ "\\n"',
  );
  if (!originalChangeId) {
    notify(
      ctx,
      "Could not record the current Jujutsu working-copy change",
      "error",
    );
    return undefined;
  }

  const bookmark = `pi-review/pr-${pullRequest.number}`;
  const originBookmark = `pi-review/origin-pr-${pullRequest.number}-${
    originalChangeId.slice(0, 8)
  }`;
  const setOriginBookmark = await pi.exec(
    "jj",
    [
      "--repository",
      repoRoot,
      "bookmark",
      "set",
      "--allow-backwards",
      "-r",
      "@",
      originBookmark,
    ],
    { timeout: 10_000 },
  );
  if (setOriginBookmark.code !== 0) {
    notify(
      ctx,
      `Could not preserve the current working copy with bookmark ${originBookmark}: ${
        setOriginBookmark.stderr.trim() || setOriginBookmark.stdout.trim()
      }`,
      "error",
    );
    return undefined;
  }

  const restore: RepositoryRestoreState = {
    repoRoot,
    originalChangeId,
    originBookmark,
    bookmark,
    pullRequestNumber: pullRequest.number,
  };
  const setBookmark = await pi.exec(
    "jj",
    [
      "--repository",
      repoRoot,
      "bookmark",
      "set",
      "--allow-backwards",
      "-r",
      pullRequest.headRefOid,
      bookmark,
    ],
    { timeout: 10_000 },
  );
  if (setBookmark.code !== 0) {
    await pi.exec(
      "jj",
      ["--repository", repoRoot, "bookmark", "delete", originBookmark],
      { timeout: 10_000 },
    );
    notify(
      ctx,
      `Could not set local bookmark ${bookmark}: ${
        setBookmark.stderr.trim() || setBookmark.stdout.trim()
      }`,
      "error",
    );
    return undefined;
  }

  const createWorkingCopy = await pi.exec(
    "jj",
    [
      "--repository",
      repoRoot,
      "new",
      pullRequest.headRefOid,
      "--message",
      `Review PR #${pullRequest.number}: ${pullRequest.title}`,
    ],
    { timeout: 30_000 },
  );
  if (createWorkingCopy.code !== 0) {
    await workflow.restorePreparedRepository(ctx, restore);
    notify(
      ctx,
      `Could not create a working-copy change for PR #${pullRequest.number}: ${
        createWorkingCopy.stderr.trim() || createWorkingCopy.stdout.trim()
      }`,
      "error",
    );
    return undefined;
  }
  const label = `PR #${pullRequest.number}: ${pullRequest.title}`;
  const request: ReviewRequest = {
    kind: "pull-request",
    repoRoot,
    label,
    scope:
      `Changes in GitHub PR #${pullRequest.number}, from fork point ${forkPoint} through head ${pullRequest.headRefOid}. The current working copy is an empty child of the PR head so fixes remain separate.`,
    commands: [
      `jj --no-pager diff --from ${shellQuote(forkPoint)} --to @ --summary`,
      `jj --no-pager diff --from ${shellQuote(forkPoint)} --to @ --git`,
    ],
    focus,
    isolate,
    restore,
  };

  try {
    const started = await workflow.start(ctx, request);
    if (!started) {
      await workflow.restorePreparedRepository(ctx, restore);
      return undefined;
    }
    return request;
  } catch (error) {
    await workflow.restorePreparedRepository(ctx, restore);
    throw error;
  }
}

export function registerPullRequestReview(
  pi: ExtensionAPI,
  workflow: ReviewWorkflow,
): void {
  pi.registerCommand("review-pr", {
    description:
      "Fetch a GitHub PR with Jujutsu, switch to a child change, and review it",
    getArgumentCompletions: (prefix: string) => {
      const values = ["--focus ", "--isolated", "--current-session"];
      const matches = values.filter((value) => value.startsWith(prefix)).map((
        value,
      ) => ({ value, label: value }));
      return matches.length ? matches : null;
    },
    handler: async (
      rawArgs: string,
      ctx: ExtensionCommandContext,
    ): Promise<void> => {
      if (workflow.isActive()) {
        notify(
          ctx,
          "Finish the active review with /end-review first",
          "warning",
        );
        return;
      }
      const parsed = parsePullRequestArguments(rawArgs);
      if (parsed.error) {
        notify(ctx, parsed.error, "error");
        return;
      }

      let ref = parsed.ref;
      if (!ref) {
        if (!ctx.hasUI) {
          notify(
            ctx,
            "Usage: /review-pr <number|URL> [--focus <text>]",
            "error",
          );
          return;
        }
        ref = await ctx.ui.input("GitHub PR number or URL", "e.g. 123");
        if (!ref?.trim()) {
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
          "Waiting for the agent to become idle before fetching the PR",
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
      if (!(await ensureGithubCli(pi, ctx))) {
        return;
      }

      await preparePullRequest(
        pi,
        workflow,
        ctx,
        repoRoot,
        ref.trim(),
        parsed.focus,
        isolate,
      );
    },
  });
}
