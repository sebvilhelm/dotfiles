import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageDir = process.env.PI_PACKAGE_DIR;
if (!packageDir) {
  throw new Error(
    "Set PI_PACKAGE_DIR to the installed pi-coding-agent directory",
  );
}
const { discoverAndLoadExtensions } = await import(
  pathToFileURL(join(packageDir, "dist/index.js")).href
);
const extensionPath = fileURLToPath(new URL("./index.ts", import.meta.url));

async function waitFor(check) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (await check()) return;
    await setTimeout(10);
  }
  assert.fail("Timed out waiting for Plannotator");
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
    return false;
  }
}

async function fixture(t) {
  await mkdir("tmp", { recursive: true });
  const root = await mkdtemp(resolve("tmp/plannotator-runtime-"));
  const bin = join(root, "bin");
  const recordPath = join(root, "invocation.json");
  const controlPath = join(root, "control.json");
  await mkdir(bin);
  await writeFile(controlPath, JSON.stringify({ hold: true }));
  await writeFile(
    join(bin, "plannotator"),
    `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
let input = "";
for await (const chunk of process.stdin) input += chunk;
appendFileSync(process.env.PLANNOTATOR_TEST_RECORD, JSON.stringify({ pid: process.pid, args: process.argv.slice(2), input }) + "\\n");
process.on("SIGTERM", () => {
  process.stdout.write("Feedback from a cancelled review");
  process.exit(0);
});
setInterval(() => {
  const control = JSON.parse(readFileSync(process.env.PLANNOTATOR_TEST_CONTROL, "utf8"));
  if (control.hold) return;
  process.stdout.write(control.output ?? "Mock annotations");
  process.stderr.write(control.error ?? "");
  process.exit(control.code ?? 0);
}, 10);
`,
  );
  await chmod(join(bin, "plannotator"), 0o755);

  const env = {
    PATH: process.env.PATH,
    PLANNOTATOR_TEST_RECORD: process.env.PLANNOTATOR_TEST_RECORD,
    PLANNOTATOR_TEST_CONTROL: process.env.PLANNOTATOR_TEST_CONTROL,
  };
  process.env.PATH = `${bin}:${env.PATH ?? ""}`;
  process.env.PLANNOTATOR_TEST_RECORD = recordPath;
  process.env.PLANNOTATOR_TEST_CONTROL = controlPath;

  const loaded = await discoverAndLoadExtensions([extensionPath], root, root);
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  assert.deepEqual([...extension.commands.keys()].sort(), [
    "plannotator-annotate",
    "plannotator-last",
    "plannotator-review",
  ]);
  const sent = [];
  const notifications = [];
  const statuses = new Map();
  const pids = new Set();
  let idle = true;
  Object.assign(loaded.runtime, {
    sendUserMessage: (message, options) => sent.push({ message, options }),
  });
  const ctx = {
    cwd: root,
    isIdle: () => idle,
    sessionManager: {
      getBranch: () => [
        {
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Latest answer" }],
          },
        },
      ],
    },
    ui: {
      notify: (message, type) => notifications.push({ message, type }),
      setStatus: (key, value) => statuses.set(key, value),
    },
  };
  const shutdown = async () => {
    for (const handler of extension.handlers.get("session_shutdown") ?? []) {
      await handler({ type: "session_shutdown" }, ctx);
    }
  };
  t.after(async () => {
    await shutdown();
    // Also clean up when a regression fails before the shutdown hook can help.
    try {
      for (
        const line of (await readFile(recordPath, "utf8")).trim().split("\n")
      ) {
        pids.add(JSON.parse(line).pid);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    for (const pid of pids) {
      if (isAlive(pid)) process.kill(pid, "SIGKILL");
    }
    await waitFor(() => [...pids].every((pid) => !isAlive(pid)));
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  });

  const control = async (value) => {
    const path = `${controlPath}.tmp`;
    await writeFile(path, JSON.stringify(value));
    await rename(path, controlPath);
  };
  const command = async (name, args = "") => {
    await control({ hold: true });
    const definition = extension.commands.get(name);
    assert.ok(definition, `missing /${name}`);
    const returned = await Promise.race([
      definition.handler(args, ctx).then(() => true),
      setTimeout(500, false),
    ]);
    assert.equal(returned, true, `/${name} blocked Pi's prompt loop`);
  };
  const invocation = async (index = -1) => {
    let value;
    await waitFor(async () => {
      try {
        const lines = (await readFile(recordPath, "utf8")).trim().split("\n");
        const line = lines.at(index);
        if (!line) return false;
        value = JSON.parse(line);
        return true;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        return false;
      }
    });
    pids.add(value.pid);
    return value;
  };
  return {
    command,
    invocation,
    sent,
    notifications,
    statuses,
    shutdown,
    setIdle: (value) => idle = value,
    finish: async (value = {}) => {
      await control(value);
      await waitFor(() => statuses.get("plannotator") === undefined);
    },
  };
}

for (
  const { name, args = "", cliArgs, input = "", label } of [
    {
      name: "plannotator-review",
      cliArgs: ["review"],
      label: "code review",
    },
    {
      name: "plannotator-review",
      args: "https://github.com/acme/service/pull/42",
      cliArgs: ["review", "https://github.com/acme/service/pull/42"],
      label: "code review",
    },
    {
      name: "plannotator-last",
      cliArgs: ["annotate-last", "--stdin"],
      input: "Latest answer",
      label: "last message",
    },
    {
      name: "plannotator-annotate",
      args: "'docs/my file.md'",
      cliArgs: ["annotate", "docs/my file.md"],
      label: "annotation of docs/my file.md",
    },
  ]
) {
  test(`/${name} returns while the browser is open and delivers feedback`, async (t) => {
    const f = await fixture(t);
    await f.command(name, args);
    const call = await f.invocation();
    assert.deepEqual(call.args, cliArgs);
    assert.equal(call.input, input);
    assert.ok(isAlive(call.pid));
    assert.equal(f.sent.length, 0);
    assert.ok(f.statuses.get("plannotator"));

    // A normal prompt can start a run while the browser review is still open.
    f.setIdle(false);
    await f.finish();
    assert.deepEqual(f.sent, [{
      message: `Plannotator feedback (${label}):\n\nMock annotations`,
      options: { deliverAs: "followUp" },
    }]);
    assert.equal(f.notifications.at(-1).type, "info");
  });
}

test("overlapping reviews both run without blocking and deliver feedback", async (t) => {
  const f = await fixture(t);
  await f.command("plannotator-review");
  const first = await f.invocation(0);
  await f.command("plannotator-last");
  const second = await f.invocation(1);
  assert.notEqual(first.pid, second.pid);
  assert.ok(isAlive(first.pid));
  assert.ok(isAlive(second.pid));
  assert.equal(f.sent.length, 0);

  await f.finish();
  assert.equal(f.sent.length, 2);
  assert.ok(f.sent.some(({ message }) => message.includes("(code review)")));
  assert.ok(f.sent.some(({ message }) => message.includes("(last message)")));
});

test("session shutdown stops all children and discards late feedback", async (t) => {
  const f = await fixture(t);
  await f.command("plannotator-review");
  const first = await f.invocation(0);
  await f.command("plannotator-last");
  const second = await f.invocation(1);
  await f.shutdown();
  await f.shutdown(); // Cleanup is idempotent.
  await waitFor(() => !isAlive(first.pid) && !isAlive(second.pid));
  assert.equal(f.sent.length, 0);
  assert.equal(f.statuses.get("plannotator"), undefined);
  assert.equal(f.notifications.length, 2); // No stale-context notifications.
});

test("empty output and failed reviews clear the running state", async (t) => {
  const f = await fixture(t);
  await f.command("plannotator-review");
  await f.finish({ output: " \n " });
  assert.equal(f.sent.length, 0);
  assert.match(f.notifications.at(-1).message, /without returning feedback/);

  await f.command("plannotator-review");
  await f.finish({ code: 1, error: "Review failed" });
  assert.equal(f.sent.length, 0);
  assert.equal(f.notifications.at(-1).type, "error");
  assert.match(f.notifications.at(-1).message, /Review failed/);
});

test("missing executable reports an error without blocking future commands", async (t) => {
  const f = await fixture(t);
  process.env.PATH = "";
  await f.command("plannotator-review");
  await waitFor(() => f.statuses.get("plannotator") === undefined);
  assert.equal(f.notifications.at(-1).type, "error");
  assert.match(f.notifications.at(-1).message, /ENOENT/);
  await f.command("plannotator-review");
  await waitFor(() => f.statuses.get("plannotator") === undefined);
  assert.equal(
    f.notifications.filter(({ type }) => type === "error").length,
    2,
  );
});

test("starting a review while Pi is busy still warns without spawning", async (t) => {
  const f = await fixture(t);
  f.setIdle(false);
  await f.command("plannotator-review");
  assert.equal(f.notifications.at(-1).type, "warning");
  assert.match(f.notifications.at(-1).message, /Wait until Pi is idle/);
  assert.equal(f.statuses.size, 0);
  assert.equal(f.sent.length, 0);
});
