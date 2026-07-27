import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import {
  ContextAccumulator,
  findNestedAgentsFiles,
  normalizeReadPath,
} from "./core.ts";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-nested-agents-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function createProject(): Promise<{
  root: string;
  target: string;
  outerAgents: string;
  innerAgents: string;
}> {
  const root = await temporaryDirectory();
  const outer = join(root, "src");
  const inner = join(outer, "components");
  const target = join(inner, "button.ts");
  const outerAgents = join(outer, "AGENTS.md");
  const innerAgents = join(inner, "AGENTS.md");

  await mkdir(inner, { recursive: true });
  await writeFile(join(root, "AGENTS.md"), "root instructions", "utf8");
  await writeFile(outerAgents, "outer instructions", "utf8");
  await writeFile(innerAgents, "inner instructions", "utf8");
  await writeFile(target, "export {};", "utf8");

  return { root, target, outerAgents, innerAgents };
}

Deno.test({
  name: "finds nested AGENTS.md files from outermost to innermost",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { root, target, outerAgents, innerAgents } = await createProject();
    const files = await findNestedAgentsFiles(root, target);

    assert.deepEqual(
      files.map((file) => file.canonicalPath),
      [await realpath(outerAgents), await realpath(innerAgents)],
    );
  },
});

Deno.test({
  name: "rejects targets and instruction symlinks outside the project",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { root } = await createProject();
    const outside = await temporaryDirectory();
    const outsideTarget = join(outside, "outside.ts");
    const outsideAgents = join(outside, "AGENTS.md");
    await writeFile(outsideTarget, "outside", "utf8");
    await writeFile(outsideAgents, "outside instructions", "utf8");

    assert.deepEqual(await findNestedAgentsFiles(root, outsideTarget), []);

    const linkedDirectory = join(root, "linked");
    const linkedTarget = join(linkedDirectory, "file.ts");
    await mkdir(linkedDirectory);
    await writeFile(linkedTarget, "target", "utf8");
    await symlink(outsideAgents, join(linkedDirectory, "AGENTS.md"));

    assert.deepEqual(await findNestedAgentsFiles(root, linkedTarget), []);
  },
});

Deno.test("matches Pi's leading-@ path normalization", () => {
  assert.equal(normalizeReadPath("@src/file.ts"), "src/file.ts");
  assert.equal(normalizeReadPath("src/@file.ts"), "src/@file.ts");
});

Deno.test({
  name: "orders injected context and respects output limits",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { root, target, innerAgents } = await createProject();
    await writeFile(
      innerAgents,
      `${"x".repeat(10_000)}\n${"line\n".repeat(100)}`,
    );
    const files = await findNestedAgentsFiles(root, target);
    const accumulator = new ContextAccumulator(
      [{ type: "text", text: "original" }],
      2_000,
      30,
    );

    for (const file of files) {
      const content = file.canonicalPath === (await realpath(innerAgents))
        ? `${"x".repeat(10_000)}\n${"line\n".repeat(100)}`
        : "outer instructions";
      assert.equal(
        accumulator.append(await realpath(root), file, content),
        true,
      );
    }

    const output = `original${accumulator.text}`;
    assert.ok(
      output.indexOf("outer instructions") <
        output.indexOf("components/AGENTS.md"),
    );
    assert.ok(new TextEncoder().encode(output).byteLength <= 2_000);
    assert.ok(output.split("\n").length <= 30);
    assert.match(output, /AGENTS\.md truncated/);
  },
});

Deno.test({
  name: "cleanup temporary directories",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      ),
    );
  },
});
