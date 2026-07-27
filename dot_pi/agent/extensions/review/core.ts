export type IsolationPreference = "isolated" | "current";

export type LocalTargetSpec =
  | { type: "trunk" }
  | { type: "working-copy" }
  | { type: "revset"; revset: string };

export type ParsedLocalArgs = {
  target?: LocalTargetSpec;
  focus?: string;
  isolation?: IsolationPreference;
  error?: string;
};

export type ParsedPullRequestArgs = {
  ref?: string;
  focus?: string;
  isolation?: IsolationPreference;
  error?: string;
};

type ParsedTokens = { tokens: string[] } | { error: string };

type CommonArguments = {
  positional: string[];
  focus?: string;
  isolation?: IsolationPreference;
  error?: string;
};

export function tokenizeArguments(value: string): ParsedTokens {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;

  for (const character of value) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }

    if (character === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = undefined;
      } else {
        current += character;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (escaping) {
    return { error: "Argument list ends with an incomplete escape" };
  }
  if (quote) {
    return { error: `Argument list has an unterminated ${quote} quote` };
  }
  if (current) {
    tokens.push(current);
  }

  return { tokens };
}

function parseCommonArguments(rawArgs: string): CommonArguments {
  const tokenized = tokenizeArguments(rawArgs.trim());
  if ("error" in tokenized) {
    return { positional: [], error: tokenized.error };
  }

  const positional: string[] = [];
  let focus: string | undefined;
  let isolation: IsolationPreference | undefined;

  for (let index = 0; index < tokenized.tokens.length; index += 1) {
    const token = tokenized.tokens[index];
    if (token === "--focus" || token === "--extra") {
      const value = tokenized.tokens[index + 1];
      if (!value) {
        return { positional, error: `Missing value for ${token}` };
      }
      focus = value;
      index += 1;
      continue;
    }

    if (token.startsWith("--focus=") || token.startsWith("--extra=")) {
      const value = token.slice(token.indexOf("=") + 1).trim();
      if (!value) {
        return {
          positional,
          error: `Missing value for ${token.split("=")[0]}`,
        };
      }
      focus = value;
      continue;
    }

    if (token === "--isolated") {
      if (isolation === "current") {
        return {
          positional,
          error: "Cannot combine --isolated and --current-session",
        };
      }
      isolation = "isolated";
      continue;
    }

    if (token === "--current-session") {
      if (isolation === "isolated") {
        return {
          positional,
          error: "Cannot combine --isolated and --current-session",
        };
      }
      isolation = "current";
      continue;
    }

    if (token.startsWith("--")) {
      return { positional, error: `Unknown option: ${token}` };
    }

    positional.push(token);
  }

  return { positional, focus, isolation };
}

export function parseLocalArguments(rawArgs: string): ParsedLocalArgs {
  const parsed = parseCommonArguments(rawArgs);
  if (parsed.error) {
    return { error: parsed.error };
  }

  const [command, ...rest] = parsed.positional;
  if (!command) {
    return { focus: parsed.focus, isolation: parsed.isolation };
  }

  if (command === "trunk") {
    return rest.length === 0
      ? {
        target: { type: "trunk" },
        focus: parsed.focus,
        isolation: parsed.isolation,
      }
      : { error: "Usage: /review-local trunk [--focus <text>]" };
  }

  if (["wc", "@", "working-copy", "workingcopy"].includes(command)) {
    return rest.length === 0
      ? {
        target: { type: "working-copy" },
        focus: parsed.focus,
        isolation: parsed.isolation,
      }
      : { error: "Usage: /review-local wc [--focus <text>]" };
  }

  if (command === "revset") {
    const revset = rest.join(" ").trim();
    return revset
      ? {
        target: { type: "revset", revset },
        focus: parsed.focus,
        isolation: parsed.isolation,
      }
      : { error: "Usage: /review-local revset <jj-revset> [--focus <text>]" };
  }

  return {
    error: `Unknown review target: ${command}. Expected trunk, wc, or revset.`,
  };
}

export function parsePullRequestArguments(
  rawArgs: string,
): ParsedPullRequestArgs {
  const parsed = parseCommonArguments(rawArgs);
  if (parsed.error) {
    return { error: parsed.error };
  }
  if (parsed.positional.length > 1) {
    return { error: "Usage: /review-pr [number|URL] [--focus <text>]" };
  }

  return {
    ref: parsed.positional[0],
    focus: parsed.focus,
    isolation: parsed.isolation,
  };
}

export function parsePullRequestReference(value: string): number | undefined {
  const trimmed = value.trim();
  if (/^[1-9]\d*$/.test(trimmed)) {
    return Number(trimmed);
  }

  const match = trimmed.match(
    /^https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/([1-9]\d*)\/?(?:[?#].*)?$/i,
  );
  return match ? Number(match[1]) : undefined;
}

export function pullRequestRepository(value: string): string | undefined {
  const match = value.trim().match(
    /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/[1-9]\d*\/?(?:[?#].*)?$/i,
  );
  return match?.[1].toLowerCase();
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function exactPattern(value: string): string {
  return `exact:${JSON.stringify(value)}`;
}

export function remoteBookmarkRevset(bookmark: string, remote: string): string {
  return `remote_bookmarks(${exactPattern(bookmark)}, ${exactPattern(remote)})`;
}

export function normalizeGitHubRepository(value: string): string | undefined {
  const trimmed = value.trim().replace(/\.git$/i, "");
  const match = trimmed.match(/(?:github\.com[/:])([^/\s]+\/[^/\s]+)$/i);
  return match?.[1].toLowerCase();
}

export function parseRemoteList(
  output: string,
): Array<{ name: string; url: string }> {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^(\S+)\s+(.+)$/);
      return match ? [{ name: match[1], url: match[2].trim() }] : [];
    });
}
