// Uses the installed Pi loader, but no model calls, credentials, or network.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
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
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
await mkdir("tmp", { recursive: true });
const root = await mkdtemp(resolve("tmp/profiles-runtime-"));
process.env.PI_CODING_AGENT_DIR = root;
after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true });
});
await mkdir(join(root, "profiles"));

async function harness(
  profile,
  { name = "test", reason = "startup", args = [], commands = [] } = {},
) {
  if (profile !== undefined) {
    await writeFile(
      join(root, "profiles", `${name}.json`),
      JSON.stringify(profile),
    );
  }
  const previousArgs = process.argv;
  process.argv = ["node", "pi", ...args];
  let result;
  try {
    result = await discoverAndLoadExtensions([extensionPath], root, root);
  } finally {
    process.argv = previousArgs;
  }
  assert.deepEqual(result.errors, []);
  if (profile !== undefined || name !== "test") {
    result.runtime.flagValues.set("profile", name);
  }
  const extension = result.extensions[0];
  const state = {
    tools: ["read", "write", "bash", "web_search"],
    models: [],
    thinking: [],
    shutdown: false,
    notifications: [],
  };
  Object.assign(result.runtime, {
    getActiveTools: () => state.tools,
    getAllTools: () =>
      [...new Set([...state.tools, ...extension.tools.keys()])].map((name) => ({
        name,
        exposure: "direct",
      })),
    setActiveTools: (tools) => {
      state.tools = tools;
    },
    getCommands: () => commands,
    setModel: (model) => {
      state.models.push(model);
      return Promise.resolve(true);
    },
    setThinkingLevel: (level) => {
      state.thinking.push(level);
    },
  });
  const ctx = {
    cwd: root,
    ui: {
      notify: (...args) => state.notifications.push(args),
      setStatus: () => {},
    },
    shutdown: () => {
      state.shutdown = true;
    },
    modelRegistry: { find: (provider, id) => ({ provider, id }) },
  };
  const emit = async (type, fields = {}) => {
    let result;
    for (const handler of extension.handlers.get(type) ?? []) {
      result = await handler({ type, ...fields }, ctx);
    }
    return result;
  };
  await emit("session_start", { reason });
  return { emit, state, extension };
}

const options = () => ({
  skills: [{ name: "cooking", filePath: join(root, "cooking/SKILL.md") }],
  contextFiles: [{ path: "AGENTS.md", content: "Code" }],
  selectedTools: ["read", "write"],
  appendSystemPrompt: "Global append",
  sections: {},
});

test("without --profile, tools, prompt and defaults stay untouched", async () => {
  const h = await harness();
  const prompt = options();
  const before = structuredClone(prompt);
  await h.emit("before_agent_start", { systemPromptOptions: prompt });
  assert.deepEqual(prompt, before);
  assert.deepEqual(h.state.tools, ["read", "write", "bash", "web_search"]);
  assert.deepEqual(h.state.thinking, []);
  assert.equal(h.state.shutdown, false);
});

test("research applies prompt/skill/tool selection without resetting reasoning on each turn", async () => {
  const h = await harness({
    tools: ["web_search", "read"],
    skills: [],
    thinkingLevel: "medium",
    inheritContext: false,
    prompt: { mode: "replace", text: "Research" },
  });
  const prompt = options();
  await h.emit("before_agent_start", { systemPromptOptions: prompt });
  assert.deepEqual(h.state.tools, ["read", "web_search"]);
  assert.deepEqual(h.state.thinking, ["medium"]);
  assert.equal(prompt.customPrompt, "Research");
  assert.deepEqual(prompt.skills, []);
  assert.deepEqual(prompt.contextFiles, []);
});

test("empty tool allowlist removes every tool and blocks nested calls", async () => {
  const h = await harness({ tools: [] });
  const result = await h.emit("tool_call", {
    toolName: "write",
    input: {},
    parentToolCallId: "parent",
  });
  assert.deepEqual(h.state.tools, []);
  assert.equal(result.block, true);
});

test("excluded skills cannot be explicitly invoked before the first model turn", async () => {
  const h = await harness({ skills: [] }, {
    commands: [{
      source: "skill",
      name: "skill:cooking",
      sourceInfo: { path: join(root, "cooking/SKILL.md") },
    }],
  });
  const result = await h.emit("input", { text: "/skill:cooking bake bread" });
  assert.deepEqual(result, { action: "handled" });
});

test("excluded skill files cannot be read through a symlink", async () => {
  await mkdir(join(root, "cooking"), { recursive: true });
  const skillPath = join(root, "cooking/SKILL.md");
  await writeFile(skillPath, "Cooking");
  const alias = join(root, "alias.md");
  await symlink(skillPath, alias);
  const h = await harness({ skills: [] }, {
    commands: [{
      source: "skill",
      name: "skill:cooking",
      sourceInfo: { path: skillPath },
    }],
  });
  const result = await h.emit("tool_call", {
    toolName: "read",
    input: { path: alias },
  });
  assert.equal(result.block, true);
});

test("selected skill files can still be read", async () => {
  const h = await harness({ skills: ["cooking"] });
  const result = await h.emit("tool_call", {
    toolName: "read",
    input: { path: join(root, "cooking/SKILL.md") },
  });
  assert.equal(result, undefined);
});

test("custom TypeScript tool modules register only in the selected profile", async () => {
  const modulePath = join(root, "profiles/ebay.ts");
  await writeFile(
    modulePath,
    `import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function register(pi: Pick<ExtensionAPI, "registerTool">) {
  pi.registerTool({ name: "search_ebay", label: "eBay", description: "Test search", parameters: Type.Object({}), execute: async () => ({ content: [], details: undefined }) });
}`,
  );
  const h = await harness({
    tools: ["read", "search_ebay"],
    toolModules: ["./ebay.ts"],
  });
  assert.equal(h.state.shutdown, false, JSON.stringify(h.state.notifications));
  assert.equal(h.extension.tools.has("search_ebay"), true);
  assert.deepEqual(h.state.tools, ["read", "search_ebay"]);
});

test("ordinary local files can still be read when skills are disabled", async () => {
  const h = await harness({ skills: [] });
  const result = await h.emit("tool_call", {
    toolName: "read",
    input: { path: join(root, "notes.md") },
  });
  assert.equal(result, undefined);
});

test("invalid custom tool modules stop the profile", async () => {
  await writeFile(join(root, "profiles/broken.ts"), "export default {};");
  const h = await harness({ toolModules: ["./broken.ts"] });
  assert.equal(h.state.shutdown, true);
  assert.deepEqual(h.state.tools, []);
});

test("legacy --research and --profile cannot be combined", async () => {
  const h = await harness({}, { args: ["--research"] });
  assert.equal(h.state.shutdown, true);
  assert.deepEqual(h.state.tools, []);
});

test("unselected modules do not execute", async () => {
  await writeFile(
    join(root, "profiles/not-selected.ts"),
    'throw new Error("must not load");',
  );
  const h = await harness({});
  assert.equal(h.state.shutdown, false);
  assert.equal(h.extension.tools.has("search_ebay"), false);
});

test("profile skill paths are added during resource discovery", async () => {
  const h = await harness({ skillPaths: ["./cooking"] });
  const result = await h.emit("resources_discover");
  assert.deepEqual(result.skillPaths, [join(root, "profiles/cooking")]);
});

test("model/reasoning defaults are not reapplied during reload", async () => {
  const h = await harness({
    model: { provider: "example", id: "small" },
    thinkingLevel: "medium",
  }, { reason: "reload" });
  assert.deepEqual(h.state.models, []);
  assert.deepEqual(h.state.thinking, []);
});

test("model/reasoning defaults apply once at startup", async () => {
  const h = await harness({
    model: { provider: "example", id: "small" },
    thinkingLevel: "medium",
  });
  assert.deepEqual(h.state.models, [{ provider: "example", id: "small" }]);
  assert.deepEqual(h.state.thinking, ["medium"]);
});

test("explicit CLI model and reasoning take precedence", async () => {
  const h = await harness({
    model: { provider: "example", id: "small" },
    thinkingLevel: "medium",
  }, { args: ["--model", "other:high", "--thinking", "low"] });
  assert.deepEqual(h.state.models, []);
  assert.deepEqual(h.state.thinking, []);
});

test("invalid profiles shut down and continue blocking inputs and tool calls", async () => {
  const h = await harness({ tools: "read" });
  assert.equal(h.state.shutdown, true);
  assert.deepEqual(h.state.tools, []);
  assert.deepEqual(await h.emit("input", { text: "hello" }), {
    action: "handled",
  });
  assert.equal(
    (await h.emit("tool_call", { toolName: "read", input: {} })).block,
    true,
  );
});

test("missing profiles do not fall back to an unrestricted session", async () => {
  const h = await harness(undefined, { name: "missing" });
  assert.equal(h.state.shutdown, true);
  assert.deepEqual(h.state.tools, []);
});
