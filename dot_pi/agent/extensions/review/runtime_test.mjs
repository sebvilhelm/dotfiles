// Real Jujutsu repositories; GitHub, Pi UI, and model calls are stubbed.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const packageDir = process.env.PI_PACKAGE_DIR;
if (!packageDir) {
  throw new Error(
    "Set PI_PACKAGE_DIR to the installed pi-coding-agent directory",
  );
}
const require = createRequire(join(packageDir, "package.json"));
const { createJiti } = require("jiti");
const jiti = createJiti(import.meta.url);
const { default: reviewExtension } = await jiti.import("./index.ts");
const exec = promisify(execFile);
const restoreType = "personal-review-restore-v1";
const stateType = "personal-review-state-v1";

async function reviewCase(t) {
  await mkdir("tmp", { recursive: true });
  const root = await mkdtemp(resolve("tmp/review-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = {
    ...process.env,
    JJ_CONFIG: "",
    JJ_USER: "Review Test",
    JJ_EMAIL: "review@example.test",
  };
  const jj = async (...args) => {
    const result = await exec("jj", ["--repository", root, ...args], { env });
    return result.stdout.trim();
  };
  const commitId = () => jj("log", "-r", "@", "--no-graph", "-T", "commit_id");
  await exec("jj", ["git", "init", root], { env });
  await jj("describe", "-m", "Base");
  const base = await commitId();
  await jj("new", "-m", "Feature");
  await writeFile(join(root, "feature.txt"), "Feature\n");
  const head = await commitId();
  await jj("new");

  const data = {
    entries: [],
    notifications: [],
    navigations: [],
    messages: [],
    commands: new Map(),
    failNextEdit: false,
  };
  const latestRestore = () =>
    data.entries.findLast((entry) => entry.customType === restoreType)?.data;
  const ctx = {
    cwd: root,
    hasUI: true,
    isIdle: () => true,
    waitForIdle: async () => {},
    isProjectTrusted: () => false,
    sessionManager: {
      getEntries: () => data.entries,
      getBranch: () => data.entries,
      getLeafId: () => "conversation-origin",
    },
    ui: {
      notify: (message, level) => data.notifications.push({ message, level }),
      setWidget: () => {},
    },
    navigateTree: (id, options) => {
      data.navigations.push({ id, ...options });
      return Promise.resolve({ cancelled: false });
    },
  };
  const command = (name, args = "") =>
    data.commands.get(name).handler(args, ctx);
  const install = async () => {
    const handlers = new Map();
    reviewExtension({
      on: (name, handler) => handlers.set(name, handler),
      registerCommand: (name, definition) =>
        data.commands.set(name, definition),
      appendEntry: (customType, entryData) =>
        data.entries.push({ type: "custom", customType, data: entryData }),
      sendUserMessage: (message) => data.messages.push(message),
      exec: async (name, args) => {
        const success = (stdout = "") => ({ code: 0, stdout, stderr: "" });
        if (name === "gh") {
          if (args[0] === "pr") {
            return success(JSON.stringify({
              number: 42,
              title: "Feature",
              baseRefName: "main",
              baseRefOid: base,
              headRefName: "feature",
              headRefOid: head,
              headRepository: { nameWithOwner: "acme/service" },
            }));
          }
          if (args[0] === "repo") {
            return success(JSON.stringify({
              nameWithOwner: "acme/service",
              url: "https://github.com/acme/service",
              sshUrl: "git@github.com:acme/service.git",
            }));
          }
          return success();
        }
        assert.equal(name, "jj");
        if (args.includes("remote")) {
          return success("origin https://github.com/acme/service.git\n");
        }
        if (args.includes("fetch")) return success();
        if (args.some((arg) => arg.startsWith("remote_bookmarks("))) {
          return success(`${head}\n`);
        }
        if (args.includes("edit") && data.failNextEdit) {
          data.failNextEdit = false;
          return { code: 1, stdout: "", stderr: "Simulated restore failure" };
        }
        try {
          const { stdout, stderr } = await exec(name, args, { cwd: root, env });
          return { code: 0, stdout, stderr };
        } catch (error) {
          if (typeof error.code !== "number") throw error;
          return {
            code: error.code,
            stdout: error.stdout,
            stderr: error.stderr,
          };
        }
      },
    });
    await handlers.get("session_start")({}, ctx);
  };
  const startReview = async () => {
    data.originalChangeId = await jj(
      "log",
      "-r",
      "@",
      "--no-graph",
      "-T",
      "change_id",
    );
    data.originalCommitId = await commitId();
    data.expectedCommitId = data.originalCommitId;
    await command("review-pr", "42 --isolated");
    assert.ok(
      data.entries.some((entry) =>
        entry.customType === stateType && entry.data.active
      ),
      JSON.stringify(data.notifications),
    );
    data.reviewChangeId = await jj(
      "log",
      "-r",
      "@",
      "--no-graph",
      "-T",
      "change_id",
    );
  };
  await install();

  return {
    given: {
      reviewOfEmptyWorkingCopy: startReview,
      reviewOfRewrittenWorkingCopy: async () => {
        await writeFile(join(root, "original.txt"), "Original work\n");
        await startReview();
        await jj("describe", "-r", data.originalChangeId, "-m", "Rewritten");
        data.expectedCommitId = await jj(
          "log",
          "-r",
          data.originalChangeId,
          "--no-graph",
          "-T",
          "commit_id",
        );
      },
      deferredRestoreAfterReload: async () => {
        await startReview();
        await command("end-review", "fix");
        await install();
      },
      previouslyFailedRestore: async () => {
        await startReview();
        data.failNextEdit = true;
        await command("end-review", "return");
        await install();
        data.notifications = [];
      },
      legacyReviewOfVisibleWorkingCopy: async () => {
        await jj("describe", "-m", "Original work");
        await startReview();
        const state =
          data.entries.findLast((entry) => entry.customType === stateType).data;
        delete state.restore.originalCommitId;
        await install();
      },
      nextRestoreFails: () => {
        data.failNextEdit = true;
      },
    },
    when: {
      endingReview: () => command("end-review", "return"),
      summarizingReview: () => command("end-review", "summarize"),
      restoringWorkingCopy: () => command("review-restore"),
    },
    then: {
      originalWorkingCopyIsRestored: async () => {
        assert.equal(await commitId(), data.expectedCommitId);
        assert.equal(latestRestore()?.pending, false);
        assert.equal(
          await jj(
            "log",
            "-r",
            data.reviewChangeId,
            "--no-graph",
            "-T",
            "change_id",
          ),
          data.reviewChangeId,
        );
        assert.equal(
          data.notifications.some((entry) => entry.level === "error"),
          false,
          JSON.stringify(data.notifications),
        );
      },
      conversationIsSummarized: () => {
        assert.equal(data.navigations.at(-1).summarize, true);
      },
      restoreRemainsPending: () => {
        assert.equal(latestRestore()?.pending, true);
        assert.equal(latestRestore()?.originalCommitId, data.originalCommitId);
        assert.equal(latestRestore()?.reviewChangeId, data.reviewChangeId);
        assert.ok(data.notifications.some((entry) => entry.level === "error"));
      },
    },
  };
}

test("end-review restores an automatically abandoned empty working copy", async (t) => {
  const { given, when, then } = await reviewCase(t);
  await given.reviewOfEmptyWorkingCopy();
  await when.endingReview();
  await then.originalWorkingCopyIsRestored();
});

test("end-review summarize restores the working copy after navigation", async (t) => {
  const { given, when, then } = await reviewCase(t);
  await given.reviewOfEmptyWorkingCopy();
  await when.summarizingReview();
  await then.originalWorkingCopyIsRestored();
  then.conversationIsSummarized();
});

test("restoration follows the change ID when the original commit was rewritten", async (t) => {
  const { given, when, then } = await reviewCase(t);
  await given.reviewOfRewrittenWorkingCopy();
  await when.endingReview();
  await then.originalWorkingCopyIsRestored();
});

test("review-restore restores an abandoned working copy after fix and reload", async (t) => {
  const { given, when, then } = await reviewCase(t);
  await given.deferredRestoreAfterReload();
  await when.restoringWorkingCopy();
  await then.originalWorkingCopyIsRestored();
});

test("failed restoration retains the commit ID for retry", async (t) => {
  const { given, when, then } = await reviewCase(t);
  await given.reviewOfEmptyWorkingCopy();
  given.nextRestoreFails();
  await when.endingReview();
  then.restoreRemainsPending();
});

test("review-restore retries a failed restoration after reload", async (t) => {
  const { given, when, then } = await reviewCase(t);
  await given.previouslyFailedRestore();
  await when.restoringWorkingCopy();
  await then.originalWorkingCopyIsRestored();
});

test("old review state without a commit ID still restores visible changes", async (t) => {
  const { given, when, then } = await reviewCase(t);
  await given.legacyReviewOfVisibleWorkingCopy();
  await when.endingReview();
  await then.originalWorkingCopyIsRestored();
});
