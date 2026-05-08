import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorkflows } from "./loader.ts";

const yamlSource = (name: string, scriptPath = `${name}.sh`) =>
  `name: ${name}
nodes:
  - kind: script
    path: ${scriptPath}
`;

describe("loadWorkflows", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-loader-"));
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
    writeFileSync(join(dir, "foo.yaml"), yamlSource("foo"));

    const result = await loadWorkflows(dir);
    expect(Array.from(result.workflows.keys())).toEqual(["foo"]);
    expect(result.workflows.get("foo")?.name).toBe("foo");
    expect(result.sources.get("foo")).toBe(join(dir, "foo.yaml"));
    expect(result.failures).toEqual([]);
  });

  it("collects workflows from multiple files, including .yml", async () => {
    writeFileSync(join(dir, "a.yaml"), yamlSource("a"));
    writeFileSync(join(dir, "b.yml"), yamlSource("b"));

    const result = await loadWorkflows(dir);
    expect(Array.from(result.workflows.keys()).sort()).toEqual(["a", "b"]);
    expect(result.sources.get("a")).toBe(join(dir, "a.yaml"));
    expect(result.sources.get("b")).toBe(join(dir, "b.yml"));
    expect(result.failures).toEqual([]);
  });

  it("ignores non-YAML files", async () => {
    writeFileSync(join(dir, "readme.md"), "# hello");
    writeFileSync(join(dir, "stale.ts"), "export const x = 1;\n");
    writeFileSync(join(dir, "foo.yaml"), yamlSource("foo"));

    const result = await loadWorkflows(dir);
    expect(Array.from(result.workflows.keys())).toEqual(["foo"]);
    expect(result.failures).toEqual([]);
  });

  it("loads valid files alongside broken ones (per-file isolation)", async () => {
    writeFileSync(join(dir, "good.yaml"), yamlSource("good"));
    writeFileSync(join(dir, "bad.yaml"), "name: foo\nnodes: [\n");

    const result = await loadWorkflows(dir);

    expect(Array.from(result.workflows.keys())).toEqual(["good"]);
    expect(result.sources.get("good")).toBe(join(dir, "good.yaml"));
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].path).toBe(join(dir, "bad.yaml"));
    expect(result.failures[0].reason.length).toBeGreaterThan(0);
  });

  it("records the second file as a failure when two share a workflow name", async () => {
    writeFileSync(join(dir, "first.yaml"), yamlSource("dup"));
    writeFileSync(join(dir, "second.yaml"), yamlSource("dup"));

    const result = await loadWorkflows(dir);

    expect(Array.from(result.workflows.keys())).toEqual(["dup"]);
    expect(result.sources.get("dup")).toBe(join(dir, "first.yaml"));
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].path).toBe(join(dir, "second.yaml"));
    expect(result.failures[0].reason).toContain('"dup"');
    expect(result.failures[0].reason).toContain(join(dir, "first.yaml"));
  });

  it("records a failure for a file whose definition fails schema validation", async () => {
    writeFileSync(
      join(dir, "bad.yaml"),
      `name: ""
nodes:
  - kind: script
    path: x.sh
`,
    );

    const result = await loadWorkflows(dir);

    expect(result.workflows.size).toBe(0);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].path).toBe(join(dir, "bad.yaml"));
    expect(result.failures[0].reason.length).toBeGreaterThan(0);
  });

  it("records a failure when a YAML file can't be read", async () => {
    // Dangling symlink: readdir lists the entry, readFileSync fails ENOENT.
    symlinkSync("/nonexistent/kiri-loader-target", join(dir, "ghost.yaml"));

    const result = await loadWorkflows(dir);

    expect(result.workflows.size).toBe(0);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].path).toBe(join(dir, "ghost.yaml"));
    expect(result.failures[0].reason.length).toBeGreaterThan(0);
  });

  it("records a failure when YAML parses but isn't an object", async () => {
    writeFileSync(join(dir, "scalar.yaml"), "just a string\n");

    const result = await loadWorkflows(dir);

    expect(result.workflows.size).toBe(0);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].path).toBe(join(dir, "scalar.yaml"));
  });

  it("throws when the directory does not exist", () => {
    const missing = join(dir, "does-not-exist");
    expect(loadWorkflows(missing)).rejects.toThrow();
  });
});
