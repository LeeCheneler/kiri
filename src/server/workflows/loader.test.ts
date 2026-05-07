import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadWorkflows } from "./loader.ts";

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

  it("returns an empty result for an empty directory", async () => {
    const result = await loadWorkflows(dir);
    expect(result.workflows.size).toBe(0);
    expect(result.sources.size).toBe(0);
    expect(result.failures).toEqual([]);
  });

  it("loads a workflow from a single file with its source path", async () => {
    writeFileSync(join(dir, "foo.ts"), validWorkflowSource("foo"));

    const result = await loadWorkflows(dir);
    expect(Array.from(result.workflows.keys())).toEqual(["foo"]);
    expect(result.workflows.get("foo")?.name).toBe("foo");
    expect(result.sources.get("foo")).toBe(join(dir, "foo.ts"));
    expect(result.failures).toEqual([]);
  });

  it("collects workflows from multiple files", async () => {
    writeFileSync(join(dir, "a.ts"), validWorkflowSource("a"));
    writeFileSync(join(dir, "b.ts"), validWorkflowSource("b"));

    const result = await loadWorkflows(dir);
    expect(Array.from(result.workflows.keys()).sort()).toEqual(["a", "b"]);
    expect(result.sources.get("a")).toBe(join(dir, "a.ts"));
    expect(result.sources.get("b")).toBe(join(dir, "b.ts"));
    expect(result.failures).toEqual([]);
  });

  it("ignores files that export no workflows", async () => {
    writeFileSync(join(dir, "junk.ts"), "export const x = 1;\n");

    const result = await loadWorkflows(dir);
    expect(result.workflows.size).toBe(0);
    expect(result.failures).toEqual([]);
  });

  it("ignores non-.ts files", async () => {
    writeFileSync(join(dir, "readme.md"), "# hello");
    writeFileSync(join(dir, "foo.ts"), validWorkflowSource("foo"));

    const result = await loadWorkflows(dir);
    expect(Array.from(result.workflows.keys())).toEqual(["foo"]);
  });

  it("loads valid files alongside broken ones (per-file isolation)", async () => {
    writeFileSync(join(dir, "good.ts"), validWorkflowSource("good"));
    writeFileSync(join(dir, "bad.ts"), 'throw "boom";\n');

    const result = await loadWorkflows(dir);

    expect(Array.from(result.workflows.keys())).toEqual(["good"]);
    expect(result.sources.get("good")).toBe(join(dir, "good.ts"));
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].path).toBe(join(dir, "bad.ts"));
    expect(result.failures[0].reason).toContain("boom");
  });

  it("records the second file as a failure when two share a workflow name", async () => {
    writeFileSync(join(dir, "first.ts"), validWorkflowSource("dup"));
    writeFileSync(join(dir, "second.ts"), validWorkflowSource("dup"));

    const result = await loadWorkflows(dir);

    expect(Array.from(result.workflows.keys())).toEqual(["dup"]);
    expect(result.sources.get("dup")).toBe(join(dir, "first.ts"));
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].path).toBe(join(dir, "second.ts"));
    expect(result.failures[0].reason).toContain('"dup"');
    expect(result.failures[0].reason).toContain(join(dir, "first.ts"));
  });

  it("records a failure for a file whose definition fails validation", async () => {
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

    const result = await loadWorkflows(dir);

    expect(result.workflows.size).toBe(0);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].path).toBe(join(dir, "bad.ts"));
    expect(result.failures[0].reason.length).toBeGreaterThan(0);
  });

  it("records a failure for a file with a non-Error throw", async () => {
    writeFileSync(join(dir, "throws-string.ts"), `throw "boom";\n`);

    const result = await loadWorkflows(dir);

    expect(result.workflows.size).toBe(0);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].path).toBe(join(dir, "throws-string.ts"));
    expect(result.failures[0].reason).toContain("boom");
  });

  it("throws when the directory does not exist", () => {
    const missing = join(dir, "does-not-exist");
    expect(loadWorkflows(missing)).rejects.toThrow();
  });
});
