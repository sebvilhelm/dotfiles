import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
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
const root = await mkdtemp(resolve("tmp/plannotator-runtime-"));
const bin = join(root, "bin");
const recordPath = join(root, "invocation.json");
await mkdir(bin);
const originalPath = process.env.PATH;
const originalRecord = process.env.PLANNOTATOR_TEST_RECORD;
process.env.PATH = `${bin}:${originalPath ?? ""}`;
process.env.PLANNOTATOR_TEST_RECORD = recordPath;

after(async () => {
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  if (originalRecord === undefined) delete process.env.PLANNOTATOR_TEST_RECORD;
  else process.env.PLANNOTATOR_TEST_RECORD = originalRecord;
  await rm(root, { recursive: true, force: true });
});

await writeFile(
  join(bin, "plannotator"),
  `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
let input = "";
for await (const chunk of process.stdin) input += chunk;
writeFileSync(process.env.PLANNOTATOR_TEST_RECORD, JSON.stringify({ args: process.argv.slice(2), input }));
process.stdout.write("Mock annotations");
`,
);
await chmod(join(bin, "plannotator"), 0o755);

const loaded = await discoverAndLoadExtensions([extensionPath], root, root);
assert.deepEqual(loaded.errors, []);
const extension = loaded.extensions[0];
const sent = [];
const notifications = [];
Object.assign(loaded.runtime, {
  sendUserMessage: (message) => sent.push(message),
});
const ctx = {
  cwd: root,
  isIdle: () => true,
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
  ui: { notify: (message) => notifications.push(message) },
};

async function invoke(name, args = "") {
  const command = extension.commands.get(name);
  assert.ok(command, `missing /${name}`);
  await command.handler(args, ctx);
  return JSON.parse(await readFile(recordPath, "utf8"));
}

test("local Plannotator commands delegate to CLI and return feedback to Pi", async () => {
  let invocation = await invoke("plannotator-review");
  assert.deepEqual(invocation, { args: ["review"], input: "" });
  assert.match(sent.at(-1), /Plannotator feedback \(code review\):/);

  invocation = await invoke("plannotator-last");
  assert.deepEqual(invocation, {
    args: ["annotate-last", "--stdin"],
    input: "Latest answer",
  });
  assert.match(sent.at(-1), /Plannotator feedback \(last message\):/);

  invocation = await invoke("plannotator-annotate", "'docs/my file.md'");
  assert.deepEqual(invocation, {
    args: ["annotate", "docs/my file.md"],
    input: "",
  });
  assert.match(
    sent.at(-1),
    /Plannotator feedback \(annotation of docs\/my file.md\):/,
  );
  assert.equal(notifications.length, 3);
});
