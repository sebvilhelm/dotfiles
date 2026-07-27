import assert from "node:assert/strict";
import {
  exactPattern,
  normalizeGitHubRepository,
  parseLocalArguments,
  parsePullRequestArguments,
  parsePullRequestReference,
  parseRemoteList,
  pullRequestRepository,
  remoteBookmarkRevset,
  shellQuote,
  tokenizeArguments,
} from "./core.ts";

Deno.test("tokenizes quoted arguments and rejects malformed input", () => {
  assert.deepEqual(
    tokenizeArguments(`revset "trunk()..@" --focus 'error handling'`),
    {
      tokens: ["revset", "trunk()..@", "--focus", "error handling"],
    },
  );
  assert.deepEqual(tokenizeArguments(`revset 'description("don\\'t")'`), {
    tokens: ["revset", `description("don't")`],
  });
  assert.deepEqual(tokenizeArguments(`--focus "unfinished`), {
    error: 'Argument list has an unterminated " quote',
  });
});

Deno.test("parses local targets, focus, and isolation strictly", () => {
  assert.deepEqual(
    parseLocalArguments(`trunk --focus "security boundaries" --isolated`),
    {
      target: { type: "trunk" },
      focus: "security boundaries",
      isolation: "isolated",
    },
  );
  assert.deepEqual(
    parseLocalArguments(`revset 'description("fix parser")' --current-session`),
    {
      target: { type: "revset", revset: 'description("fix parser")' },
      focus: undefined,
      isolation: "current",
    },
  );
  assert.deepEqual(parseLocalArguments("anything"), {
    error: "Unknown review target: anything. Expected trunk, wc, or revset.",
  });
  assert.deepEqual(parseLocalArguments("wc --unknown"), {
    error: "Unknown option: --unknown",
  });
  assert.deepEqual(parseLocalArguments("wc --isolated --current-session"), {
    error: "Cannot combine --isolated and --current-session",
  });
});

Deno.test("parses PR arguments and references without accepting prefixes", () => {
  assert.deepEqual(
    parsePullRequestArguments(`123 --extra "database changes"`),
    {
      ref: "123",
      focus: "database changes",
      isolation: undefined,
    },
  );
  assert.equal(parsePullRequestReference("123"), 123);
  assert.equal(parsePullRequestReference("123oops"), undefined);
  assert.equal(
    parsePullRequestReference("https://github.com/acme/service/pull/42"),
    42,
  );
  assert.equal(
    parsePullRequestReference("https://example.com/acme/service/pull/42"),
    undefined,
  );
  assert.equal(
    pullRequestRepository("https://github.com/Acme/Service/pull/42"),
    "acme/service",
  );
  assert.equal(pullRequestRepository("42"), undefined);
});

Deno.test("quotes shell values containing apostrophes", () => {
  assert.equal(shellQuote("trunk()"), `'trunk()'`);
  assert.equal(
    shellQuote("description('parser')"),
    `'description('"'"'parser'"'"')'`,
  );
});

Deno.test("builds exact remote bookmark revsets", () => {
  assert.equal(
    exactPattern('feature/quote"test'),
    'exact:"feature/quote\\"test"',
  );
  assert.equal(
    remoteBookmarkRevset("feature/review", "origin"),
    'remote_bookmarks(exact:"feature/review", exact:"origin")',
  );
});

Deno.test("normalizes GitHub remote URLs and parses jj remote output", () => {
  assert.equal(
    normalizeGitHubRepository("git@github.com:Acme/Service.git"),
    "acme/service",
  );
  assert.equal(
    normalizeGitHubRepository("https://github.com/Acme/Service.git"),
    "acme/service",
  );
  assert.equal(
    normalizeGitHubRepository("ssh://git@github.com/Acme/Service.git"),
    "acme/service",
  );
  assert.equal(
    normalizeGitHubRepository("https://gitlab.com/acme/service.git"),
    undefined,
  );
  assert.deepEqual(
    parseRemoteList(
      "origin git@github.com:acme/service.git\nfork https://github.com/me/service.git\n",
    ),
    [
      { name: "origin", url: "git@github.com:acme/service.git" },
      { name: "fork", url: "https://github.com/me/service.git" },
    ],
  );
});
