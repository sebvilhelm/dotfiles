import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyDiff,
  applyPatch,
  formatPatchOutput,
  parsePatch,
  type PatchChange,
} from "./core.ts";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-apply-patch-"));
  temporaryDirectories.push(directory);
  return directory;
}

Deno.test("parses the Codex patch envelope", () => {
  assert.deepEqual(
    parsePatch(`*** Begin Patch
*** Add File: added.txt
+hello
*** Update File: old.txt
*** Move to: moved.txt
@@
-old
+new
*** Delete File: deleted.txt
*** End Patch`),
    [
      { type: "add", path: "added.txt", content: "hello\n" },
      {
        type: "update",
        path: "old.txt",
        movePath: "moved.txt",
        diff: "@@\n-old\n+new",
      },
      { type: "delete", path: "deleted.txt" },
    ],
  );
});

Deno.test("applies exact and whitespace-fuzzy update hunks", () => {
  assert.equal(
    applyDiff("one\n  two  \nthree\n", "@@\n- two\n+ changed\n three"),
    "one\n changed\nthree\n",
  );
  assert.equal(
    applyDiff(
      "function first() {}\nfunction target() {\n  return 1;\n}\n",
      "@@ function target() {\n-  return 1;\n+  return 2;",
    ),
    "function first() {}\nfunction target() {\n  return 2;\n}\n",
  );
});

Deno.test({
  name: "applies add, update, move, and delete operations",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const root = await temporaryDirectory();
    await writeFile(join(root, "old.txt"), "before\n", "utf8");
    await writeFile(join(root, "deleted.txt"), "obsolete\n", "utf8");

    const result = await applyPatch(
      root,
      `*** Begin Patch
*** Add File: nested/added.txt
+created
*** Update File: old.txt
*** Move to: moved.txt
@@
-before
+after
*** Delete File: deleted.txt
*** End Patch`,
    );

    assert.equal(
      await readFile(join(root, "nested/added.txt"), "utf8"),
      "created\n",
    );
    assert.equal(await readFile(join(root, "moved.txt"), "utf8"), "after\n");
    await assert.rejects(readFile(join(root, "old.txt"), "utf8"), {
      code: "ENOENT",
    });
    await assert.rejects(readFile(join(root, "deleted.txt"), "utf8"), {
      code: "ENOENT",
    });
    assert.equal(
      result.output,
      "Success. Updated the following files:\n" +
        "A nested/added.txt\n" +
        "M moved.txt\n" +
        "D deleted.txt",
    );
  },
});

Deno.test({
  name: "rejects traversal, symlinks, and destructive Add File operations",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await writeFile(join(root, "existing.txt"), "safe\n", "utf8");
    await Deno.symlink(join(outside, "outside.txt"), join(root, "linked.txt"));

    await assert.rejects(
      applyPatch(
        root,
        "*** Begin Patch\n*** Add File: ../outside.txt\n+bad\n*** End Patch",
      ),
      /path must stay relative/,
    );
    await assert.rejects(
      applyPatch(
        root,
        "*** Begin Patch\n*** Add File: existing.txt\n+bad\n*** End Patch",
      ),
      /target already exists/,
    );
    await assert.rejects(
      applyPatch(
        root,
        "*** Begin Patch\n*** Update File: linked.txt\n@@\n-old\n+new\n*** End Patch",
      ),
      /symbolic links/,
    );
    assert.equal(await readFile(join(root, "existing.txt"), "utf8"), "safe\n");
  },
});

Deno.test({
  name: "verifies every operation before writing any files",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const root = await temporaryDirectory();
    await writeFile(join(root, "first.txt"), "before\n", "utf8");

    await assert.rejects(
      applyPatch(
        root,
        `*** Begin Patch
*** Update File: first.txt
@@
-before
+after
*** Update File: missing.txt
@@
-before
+after
*** End Patch`,
      ),
      /target does not exist/,
    );
    assert.equal(await readFile(join(root, "first.txt"), "utf8"), "before\n");
  },
});

Deno.test("preserves source line endings in updated files", () => {
  assert.equal(
    applyDiff("one\r\ntwo\r\n", "@@\n-two\n+changed"),
    "one\r\nchanged\r\n",
  );
  assert.equal(applyDiff("before", "@@\n-before\n+after"), "after");
});

Deno.test({
  name: "preserves UTF-8 BOMs through updates and moves",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const root = await temporaryDirectory();
    await writeFile(join(root, "updated.txt"), "\uFEFFbefore\n", "utf8");
    await writeFile(join(root, "moved.txt"), "\uFEFFbefore\n", "utf8");

    await applyPatch(
      root,
      `*** Begin Patch
*** Update File: updated.txt
@@
-before
+after
*** Update File: moved.txt
*** Move to: destination.txt
@@
-before
+after
*** End Patch`,
    );

    assert.equal(
      await readFile(join(root, "updated.txt"), "utf8"),
      "\uFEFFafter\n",
    );
    assert.equal(
      await readFile(join(root, "destination.txt"), "utf8"),
      "\uFEFFafter\n",
    );
  },
});

Deno.test({
  name: "canonicalizes queue targets before deduplicating case aliases",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const root = await temporaryDirectory();
    await writeFile(join(root, "Case.txt"), "before\n", "utf8");
    try {
      await readFile(join(root, "case.txt"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    const queuedPaths: string[] = [];
    await assert.rejects(
      applyPatch(
        root,
        `*** Begin Patch
*** Update File: Case.txt
*** Move to: case.txt
@@
-before
+after
*** End Patch`,
        async (path, mutate) => {
          queuedPaths.push(path);
          return await mutate();
        },
      ),
      /Move destination already exists/,
    );
    assert.equal(queuedPaths.length, 1);
  },
});

Deno.test({
  name: "cancels while waiting for the mutation queue without writing",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const root = await temporaryDirectory();
    const controller = new AbortController();
    let enterQueue!: () => void;
    let releaseQueue!: () => void;
    let finishQueue!: () => void;
    const queueEntered = new Promise<void>((resolvePromise) => {
      enterQueue = resolvePromise;
    });
    const queueReleased = new Promise<void>((resolvePromise) => {
      releaseQueue = resolvePromise;
    });
    const queueFinished = new Promise<void>((resolvePromise) => {
      finishQueue = resolvePromise;
    });
    const queue = async <T>(
      _path: string,
      mutate: () => Promise<T>,
    ): Promise<T> => {
      enterQueue();
      await queueReleased;
      try {
        return await mutate();
      } finally {
        finishQueue();
      }
    };

    const result = applyPatch(
      root,
      "*** Begin Patch\n*** Add File: cancelled.txt\n+bad\n*** End Patch",
      queue,
      controller.signal,
    );
    await queueEntered;
    controller.abort();
    await assert.rejects(result, /apply_patch cancelled/);
    releaseQueue();
    await queueFinished;
    await assert.rejects(readFile(join(root, "cancelled.txt")), {
      code: "ENOENT",
    });
  },
});

Deno.test({
  name: "cancels after staging starts without changing files",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const root = await temporaryDirectory();
    const controller = new AbortController();
    await writeFile(join(root, "unchanged.txt"), "before\n", "utf8");

    await assert.rejects(
      applyPatch(
        root,
        `*** Begin Patch
*** Update File: unchanged.txt
@@
-before
+after
*** End Patch`,
        async (_path, mutate) => {
          const result = mutate();
          controller.abort();
          return await result;
        },
        controller.signal,
      ),
      /apply_patch cancelled/,
    );
    assert.equal(
      await readFile(join(root, "unchanged.txt"), "utf8"),
      "before\n",
    );
  },
});

Deno.test("truncates oversized patch result output", () => {
  const lineLimitedChanges: PatchChange[] = Array.from(
    { length: 3_000 },
    (_, index) => ({ status: "A", path: `${index}.txt` }),
  );
  const byteLimitedChanges: PatchChange[] = Array.from(
    { length: 3_000 },
    (_, index) => ({
      status: "A",
      path: `nested/${index.toString().padStart(4, "0")}/${"x".repeat(40)}.txt`,
    }),
  );

  for (
    const output of [
      formatPatchOutput(lineLimitedChanges),
      formatPatchOutput(byteLimitedChanges),
    ]
  ) {
    assert.ok(output.split("\n").length <= 2_000);
    assert.ok(new TextEncoder().encode(output).byteLength <= 50 * 1_024);
    assert.match(output, /Output truncated: showing \d+ of 3000 file changes/);
  }
});

Deno.test({
  name: "accepts in-tree names beginning with two dots",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const root = await temporaryDirectory();
    await applyPatch(
      root,
      `*** Begin Patch
*** Add File: ..config
+config
*** Add File: ..data/value.txt
+data
*** End Patch`,
    );

    assert.equal(await readFile(join(root, "..config"), "utf8"), "config\n");
    assert.equal(
      await readFile(join(root, "..data/value.txt"), "utf8"),
      "data\n",
    );
  },
});

Deno.test({
  name: "cleans up temporary directories",
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
