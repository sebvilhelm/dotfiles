import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  applyProfilePrompt,
  hasCliOption,
  hasCliThinkingOverride,
  loadProfile,
  matchesSelection,
  parseProfile,
  resolveProfilePath,
} from "./core.ts";

Deno.test("omitted fields inherit defaults; empty lists select nothing", () => {
  assert.deepEqual(parseProfile({}), {});
  const profile = parseProfile({ tools: [], skills: [] });
  assert.deepEqual(profile.tools, { include: [] });
  assert.equal(matchesSelection(undefined, "bash", "/profiles"), true);
  assert.equal(matchesSelection(profile.tools, "bash", "/profiles"), false);
  assert.equal(matchesSelection(profile.skills, "cooking", "/profiles"), false);
});

Deno.test("validates optional model, reasoning, prompt and custom resources", () => {
  const config = {
    model: { provider: "example", id: "small" },
    thinkingLevel: "medium",
    tools: { exclude: ["bash"] },
    skills: { include: ["cook*"], exclude: ["cooking-unsafe"] },
    skillPaths: ["./skills"],
    toolModules: ["./tools/ebay.ts"],
    inheritContext: false,
    prompt: { mode: "replace", file: "research.md" },
  };
  assert.deepEqual(parseProfile(config), {
    ...config,
    tools: { include: undefined, exclude: ["bash"] },
    prompt: { ...config.prompt, text: undefined },
  });
});

Deno.test("rejects malformed profiles instead of silently inheriting defaults", () => {
  for (
    const value of [
      null,
      [],
      { typo: true },
      { model: "example/small" },
      { model: { provider: "example" } },
      { model: { provider: "example", id: "" } },
      { thinkingLevel: "maximum" },
      { tools: "read" },
      { tools: [3] },
      { skills: { excludes: [] } },
      { toolModules: [""] },
      { skillPaths: false },
      { inheritContext: "false" },
      { prompt: { mode: "replace" } },
      { prompt: { mode: "replace", text: "a", file: "b" } },
      { prompt: { mode: "unknown", text: "a" } },
    ]
  ) {
    assert.throws(() => parseProfile(value), JSON.stringify(value));
  }
});

Deno.test("selection supports name globs with exclusion taking precedence", () => {
  const selection = { include: ["web_*", "read"], exclude: ["web_delete"] };
  assert.equal(matchesSelection(selection, "web_search", "/profiles"), true);
  assert.equal(matchesSelection(selection, "read", "/profiles"), true);
  assert.equal(matchesSelection(selection, "web_delete", "/profiles"), false);
  assert.equal(matchesSelection(selection, "write", "/profiles"), false);
  assert.equal(
    matchesSelection({ exclude: ["bash"] }, "read", "/profiles"),
    true,
  );
  assert.equal(
    matchesSelection({ include: ["a.b"] }, "axb", "/profiles"),
    false,
  );
});

Deno.test("skill paths match containing directories, not similarly named siblings", () => {
  const selection = { exclude: ["./lunar"] };
  assert.equal(
    matchesSelection(
      selection,
      "logging",
      "/profiles",
      "/profiles/lunar/logging/SKILL.md",
    ),
    false,
  );
  assert.equal(
    matchesSelection(
      selection,
      "logging",
      "/profiles",
      "/profiles/lunar-other/logging/SKILL.md",
    ),
    true,
  );
  assert.equal(
    matchesSelection(
      { include: ["./recipes/*/SKILL.md"] },
      "baking",
      "/profiles",
      "/profiles/recipes/baking/SKILL.md",
    ),
    true,
  );
  assert.equal(
    resolveProfilePath("/profiles", "~/recipes"),
    join(homedir(), "recipes"),
  );
  assert.equal(
    resolveProfilePath("/profiles", "./recipes"),
    "/profiles/recipes",
  );
});

function promptOptions() {
  return {
    skills: [{ name: "cooking", filePath: "/skills/cooking/SKILL.md" }],
    contextFiles: [{ path: "/AGENTS.md", content: "coding" }],
    customPrompt: "default coding prompt",
    appendSystemPrompt: "global instructions",
    sections: { unrelated: "preserve me" },
  };
}

Deno.test("replacement keeps selected skills but can omit coding context and appended instructions", () => {
  const options = promptOptions();
  applyProfilePrompt({
    profile: parseProfile({
      skills: [],
      inheritContext: false,
      prompt: { mode: "replace", text: "Research" },
    }),
    directory: "/profiles",
    promptText: "Research",
  }, options);
  assert.equal(options.customPrompt, "Research");
  assert.equal(options.appendSystemPrompt, "");
  assert.deepEqual(options.skills, []);
  assert.deepEqual(options.contextFiles, []);
  assert.deepEqual(options.sections, { unrelated: "preserve me" });
});

Deno.test("appended profile prompt preserves Pi context and skills", () => {
  const options = promptOptions();
  const before = structuredClone(options);
  applyProfilePrompt({
    profile: parseProfile({ prompt: { mode: "append", text: "Cook" } }),
    directory: "/profiles",
    promptText: "Cook",
  }, options);
  assert.deepEqual(options, {
    ...before,
    sections: { ...before.sections, profile: "Cook" },
  });
  const inherited = promptOptions();
  applyProfilePrompt({ profile: {}, directory: "/profiles" }, inherited);
  assert.deepEqual(inherited, before);
});

Deno.test("CLI overrides recognize equals syntax and stop at the option terminator", () => {
  assert.equal(hasCliOption(["--model", "small"], "--model"), true);
  assert.equal(hasCliOption(["--thinking=high"], "--thinking"), true);
  assert.equal(hasCliOption(["--", "--model"], "--model"), false);
  assert.equal(hasCliOption(["--model-other"], "--model"), false);
});

Deno.test("CLI reasoning suffixes override profile reasoning, plain model flags do not", () => {
  assert.equal(hasCliThinkingOverride(["--model", "example/small:high"]), true);
  assert.equal(hasCliThinkingOverride(["--model=example/small:low"]), true);
  assert.equal(hasCliThinkingOverride(["--models", "example/*:medium"]), true);
  assert.equal(hasCliThinkingOverride(["--thinking", "low"]), true);
  assert.equal(hasCliThinkingOverride(["--model", "example/small"]), false);
  assert.equal(hasCliThinkingOverride(["--", "--thinking"]), false);
});

Deno.test("loads only named user profiles and resolves prompt files relative to the JSON", async () => {
  await mkdir("tmp", { recursive: true });
  const root = await mkdtemp(resolve("tmp/profiles-core-"));
  try {
    await mkdir(join(root, "profiles"));
    await writeFile(
      join(root, "profiles", "research.json"),
      JSON.stringify({
        prompt: { mode: "replace", file: "research.md" },
      }),
    );
    await writeFile(
      join(root, "profiles", "research.md"),
      "Research instructions",
    );
    const loaded = await loadProfile(root, "research");
    assert.equal(loaded.promptText, "Research instructions");
    assert.equal(loaded.directory, join(root, "profiles"));
    await assert.rejects(loadProfile(root, "../other"), /Profile names/);
    await assert.rejects(loadProfile(root, "missing"), /ENOENT/);
    await rm(join(root, "profiles", "research.md"));
    await assert.rejects(loadProfile(root, "research"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

Deno.test("directory profiles resolve explicit resources relative to profile.json", async () => {
  await mkdir("tmp", { recursive: true });
  const root = await mkdtemp(resolve("tmp/profiles-directory-"));
  try {
    const directory = join(root, "profiles", "research");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(root, "shared-prompt.md"),
      "Shared research instructions",
    );
    await writeFile(
      join(directory, "profile.json"),
      JSON.stringify({
        prompt: { mode: "replace", file: "../../shared-prompt.md" },
        skillPaths: ["./skills"],
        toolModules: ["../shared-tools/ebay.ts"],
      }),
    );
    const loaded = await loadProfile(root, "research");
    assert.equal(loaded.directory, directory);
    assert.equal(loaded.promptText, "Shared research instructions");
    assert.equal(
      resolveProfilePath(
        loaded.directory,
        loaded.profile.skillPaths?.[0] ?? "",
      ),
      join(directory, "skills"),
    );
    assert.equal(
      resolveProfilePath(
        loaded.directory,
        loaded.profile.toolModules?.[0] ?? "",
      ),
      join(root, "profiles", "shared-tools", "ebay.ts"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

Deno.test("directory profiles do not discover sibling prompts or tool modules", async () => {
  await mkdir("tmp", { recursive: true });
  const root = await mkdtemp(resolve("tmp/profiles-explicit-"));
  try {
    const directory = join(root, "profiles", "research");
    await mkdir(join(directory, "tools"), { recursive: true });
    await writeFile(join(directory, "profile.json"), "{}");
    await writeFile(join(directory, "prompt.md"), "Not selected");
    await writeFile(
      join(directory, "tools", "search.ts"),
      "throw new Error('not selected');",
    );
    const loaded = await loadProfile(root, "research");
    assert.deepEqual(loaded.profile, {});
    assert.equal(loaded.promptText, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

Deno.test("flat profiles take precedence and invalid configurations do not fall back", async () => {
  await mkdir("tmp", { recursive: true });
  const root = await mkdtemp(resolve("tmp/profiles-precedence-"));
  try {
    const profiles = join(root, "profiles");
    await mkdir(join(profiles, "research"), { recursive: true });
    await writeFile(
      join(profiles, "research", "profile.json"),
      JSON.stringify({ thinkingLevel: "low" }),
    );
    const flat = join(profiles, "research.json");
    await writeFile(flat, JSON.stringify({ thinkingLevel: "high" }));
    const loaded = await loadProfile(root, "research");
    assert.equal(loaded.directory, profiles);
    assert.equal(loaded.profile.thinkingLevel, "high");
    await writeFile(flat, "invalid JSON");
    await assert.rejects(loadProfile(root, "research"), SyntaxError);
    await writeFile(flat, JSON.stringify({ thinkingLevel: "invalid" }));
    await assert.rejects(
      loadProfile(root, "research"),
      /Invalid thinkingLevel/,
    );
    await rm(flat);
    await mkdir(flat);
    await assert.rejects(loadProfile(root, "research"), /EISDIR/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

Deno.test("shipped research profile is restrictive and has a standalone research prompt", async () => {
  const loaded = await loadProfile(resolve("dot_pi/agent"), "research");
  assert.deepEqual(loaded.profile.model, {
    provider: "openai",
    id: "gpt-6-luna",
  });
  assert.deepEqual(loaded.profile.tools, { include: ["web_search", "read"] });
  assert.deepEqual(loaded.profile.skills, { include: [] });
  assert.equal(loaded.profile.thinkingLevel, "medium");
  assert.equal(loaded.profile.inheritContext, false);
  assert.match(loaded.promptText ?? "", /^You are a research assistant/);
});
