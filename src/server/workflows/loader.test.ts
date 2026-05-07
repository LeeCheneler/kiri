import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DuplicateWorkflowError, WorkflowLoadError, loadWorkflows } from "./loader.ts";

const DEFINE_PATH = resolve(import.meta.dir, "define-workflow.ts");
// Fixtures import `zod` by package name; the node resolver walks up from
// the fixture file looking for `node_modules`. Symlinking the project's
// `node_modules` into each tmp dir lets that lookup succeed without
// pinning fixtures to absolute paths.
const NODE_MODULES = resolve(import.meta.dir, "..", "..", "..", "node_modules");

const validWorkflowSource = (name: string, scriptPath = `${name}.sh`) => `
import { z } from "zod";
import { defineWorkflow } from "${DEFINE_PATH}";

export const wf = defineWorkflow({
  name: "${name}",
  inputSchema: z.object({}),
  nodes: [{ kind: "script", path: "${scriptPath}" }],
});
`;

describe("loadWorkflows", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-loader-"));
    symlinkSync(NODE_MODULES, join(dir, "node_modules"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty map for an empty directory", async () => {
    const map = await loadWorkflows(dir);
    expect(map.size).toBe(0);
  });

  it("loads a workflow from a single file", async () => {
    writeFileSync(join(dir, "foo.ts"), validWorkflowSource("foo"));

    const map = await loadWorkflows(dir);
    expect(Array.from(map.keys())).toEqual(["foo"]);
    expect(map.get("foo")?.name).toBe("foo");
  });

  it("collects workflows from multiple files", async () => {
    writeFileSync(join(dir, "a.ts"), validWorkflowSource("a"));
    writeFileSync(join(dir, "b.ts"), validWorkflowSource("b"));

    const map = await loadWorkflows(dir);
    expect(Array.from(map.keys()).sort()).toEqual(["a", "b"]);
  });

  it("ignores files that export no workflows", async () => {
    writeFileSync(join(dir, "junk.ts"), "export const x = 1;\n");

    const map = await loadWorkflows(dir);
    expect(map.size).toBe(0);
  });

  it("ignores non-.ts files", async () => {
    writeFileSync(join(dir, "readme.md"), "# hello");
    writeFileSync(join(dir, "foo.ts"), validWorkflowSource("foo"));

    const map = await loadWorkflows(dir);
    expect(Array.from(map.keys())).toEqual(["foo"]);
  });

  it("throws DuplicateWorkflowError when two files use the same name", async () => {
    writeFileSync(join(dir, "first.ts"), validWorkflowSource("dup"));
    writeFileSync(join(dir, "second.ts"), validWorkflowSource("dup"));

    let err: unknown;
    try {
      await loadWorkflows(dir);
    } catch (caught) {
      err = caught;
    }

    expect(err).toBeInstanceOf(DuplicateWorkflowError);
    const dupErr = err as DuplicateWorkflowError;
    expect(dupErr.workflowName).toBe("dup");
    expect(dupErr.paths).toEqual([join(dir, "first.ts"), join(dir, "second.ts")]);
    expect(dupErr.message).toContain('"dup"');
    expect(dupErr.message).toContain(join(dir, "first.ts"));
    expect(dupErr.message).toContain(join(dir, "second.ts"));
  });

  it("throws WorkflowLoadError with path when a definition fails validation", async () => {
    writeFileSync(
      join(dir, "bad.ts"),
      `
import { z } from "zod";
import { defineWorkflow } from "${DEFINE_PATH}";

export const wf = defineWorkflow({
  name: "",
  inputSchema: z.object({}),
  nodes: [{ kind: "script", path: "x.sh" }],
});
`,
    );

    let err: unknown;
    try {
      await loadWorkflows(dir);
    } catch (caught) {
      err = caught;
    }

    expect(err).toBeInstanceOf(WorkflowLoadError);
    const loadErr = err as WorkflowLoadError;
    expect(loadErr.path).toBe(join(dir, "bad.ts"));
    expect(loadErr.message).toContain(join(dir, "bad.ts"));
    expect(loadErr.cause).toBeDefined();
  });

  it("throws WorkflowLoadError when a file has a non-Error throw", async () => {
    writeFileSync(join(dir, "throws-string.ts"), `throw "boom";\n`);

    let err: unknown;
    try {
      await loadWorkflows(dir);
    } catch (caught) {
      err = caught;
    }

    expect(err).toBeInstanceOf(WorkflowLoadError);
    expect((err as WorkflowLoadError).message).toContain("boom");
  });

  it("throws when the directory does not exist", () => {
    const missing = join(dir, "does-not-exist");
    expect(loadWorkflows(missing)).rejects.toThrow();
  });
});
