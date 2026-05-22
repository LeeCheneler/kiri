import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorkflows } from "./loader.ts";

const yamlSource = (name: string, useName = name) =>
  `name: ${name}
steps:
  - use: ${useName}
`;

const writeBundle = (cwd: string, name: string): void => {
  const dir = join(cwd, "scripts", name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "run.sh");
  writeFileSync(path, "#!/bin/sh\necho hi\n");
  chmodSync(path, 0o755);
};

describe("loadWorkflows", () => {
  let cwd: string;
  let dir: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-loader-"));
    dir = join(cwd, "workflows");
    mkdirSync(dir);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("returns an empty result for an empty directory", async () => {
    const result = await loadWorkflows(dir, cwd);
    expect(result.workflows.size).toBe(0);
    expect(result.sources.size).toBe(0);
    expect(result.failures).toEqual([]);
  });

  it("loads a workflow from a single file with its source path", async () => {
    writeBundle(cwd, "foo");
    writeFileSync(join(dir, "foo.yaml"), yamlSource("foo"));

    const result = await loadWorkflows(dir, cwd);
    expect(Array.from(result.workflows.keys())).toEqual(["foo"]);
    expect(result.workflows.get("foo")?.name).toBe("foo");
    expect(result.sources.get("foo")).toBe(join(dir, "foo.yaml"));
    expect(result.failures).toEqual([]);
  });

  it("collects workflows from multiple files, including .yml", async () => {
    writeBundle(cwd, "a");
    writeBundle(cwd, "b");
    writeFileSync(join(dir, "a.yaml"), yamlSource("a"));
    writeFileSync(join(dir, "b.yml"), yamlSource("b"));

    const result = await loadWorkflows(dir, cwd);
    expect(Array.from(result.workflows.keys()).sort()).toEqual(["a", "b"]);
    expect(result.sources.get("a")).toBe(join(dir, "a.yaml"));
    expect(result.sources.get("b")).toBe(join(dir, "b.yml"));
    expect(result.failures).toEqual([]);
  });

  it("loads a workflow whose only step is inline sh: (no bundle needed)", async () => {
    writeFileSync(
      join(dir, "echo.yaml"),
      `name: echo
steps:
  - sh: |
      echo hi
`,
    );

    const result = await loadWorkflows(dir, cwd);
    expect(Array.from(result.workflows.keys())).toEqual(["echo"]);
    expect(result.failures).toEqual([]);
  });

  it("ignores non-YAML files", async () => {
    writeBundle(cwd, "foo");
    writeFileSync(join(dir, "readme.md"), "# hello");
    writeFileSync(join(dir, "stale.ts"), "export const x = 1;\n");
    writeFileSync(join(dir, "foo.yaml"), yamlSource("foo"));

    const result = await loadWorkflows(dir, cwd);
    expect(Array.from(result.workflows.keys())).toEqual(["foo"]);
    expect(result.failures).toEqual([]);
  });

  it("loads valid files alongside broken ones (per-file isolation)", async () => {
    writeBundle(cwd, "good");
    writeFileSync(join(dir, "good.yaml"), yamlSource("good"));
    writeFileSync(join(dir, "bad.yaml"), "name: foo\nsteps: [\n");

    const result = await loadWorkflows(dir, cwd);

    expect(Array.from(result.workflows.keys())).toEqual(["good"]);
    expect(result.sources.get("good")).toBe(join(dir, "good.yaml"));
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].path).toBe(join(dir, "bad.yaml"));
    expect(result.failures[0].reason.length).toBeGreaterThan(0);
  });

  it("records the second file as a failure when two share a workflow name", async () => {
    writeBundle(cwd, "dup");
    writeFileSync(join(dir, "first.yaml"), yamlSource("dup"));
    writeFileSync(join(dir, "second.yaml"), yamlSource("dup"));

    const result = await loadWorkflows(dir, cwd);

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
steps:
  - use: x
`,
    );

    const result = await loadWorkflows(dir, cwd);

    expect(result.workflows.size).toBe(0);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].path).toBe(join(dir, "bad.yaml"));
    expect(result.failures[0].reason.length).toBeGreaterThan(0);
  });

  it("records a failure when a use: step references a missing bundle", async () => {
    writeFileSync(join(dir, "missing.yaml"), yamlSource("missing", "ghost"));

    const result = await loadWorkflows(dir, cwd);

    expect(result.workflows.size).toBe(0);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].path).toBe(join(dir, "missing.yaml"));
    expect(result.failures[0].reason).toContain('"ghost"');
    expect(result.failures[0].reason).toContain("scripts/<name>/run.sh");
  });

  it("loads a workflow whose summarize step uses an existing bundle", async () => {
    writeBundle(cwd, "step");
    writeBundle(cwd, "summer");
    writeFileSync(
      join(dir, "wf.yaml"),
      `name: wf
steps:
  - use: step
summarize:
  use: summer
`,
    );

    const result = await loadWorkflows(dir, cwd);
    expect(Array.from(result.workflows.keys())).toEqual(["wf"]);
    expect(result.workflows.get("wf")?.summarize).toEqual({ use: "summer" });
    expect(result.failures).toEqual([]);
  });

  it("loads a workflow with an inline sh: summarize step (no bundle needed)", async () => {
    writeBundle(cwd, "step");
    writeFileSync(
      join(dir, "wf.yaml"),
      `name: wf
steps:
  - use: step
summarize:
  sh: |
    head -c 200
`,
    );

    const result = await loadWorkflows(dir, cwd);
    expect(Array.from(result.workflows.keys())).toEqual(["wf"]);
    expect(result.failures).toEqual([]);
  });

  it("records a failure when a summarize use: step references a missing bundle", async () => {
    writeBundle(cwd, "step");
    writeFileSync(
      join(dir, "wf.yaml"),
      `name: wf
steps:
  - use: step
summarize:
  use: ghost-summer
`,
    );

    const result = await loadWorkflows(dir, cwd);
    expect(result.workflows.size).toBe(0);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].path).toBe(join(dir, "wf.yaml"));
    expect(result.failures[0].reason).toContain('"ghost-summer"');
  });

  it("loads a workflow whose publish entry uses an existing bundle", async () => {
    writeBundle(cwd, "step");
    writeBundle(cwd, "writer");
    writeFileSync(
      join(dir, "wf.yaml"),
      `name: wf
steps:
  - use: step
publish:
  - name: digest
    use: writer
`,
    );

    const result = await loadWorkflows(dir, cwd);
    expect(Array.from(result.workflows.keys())).toEqual(["wf"]);
    expect(result.workflows.get("wf")?.publish).toEqual([{ name: "digest", use: "writer" }]);
    expect(result.failures).toEqual([]);
  });

  it("loads a workflow with an inline sh: publish entry (no bundle needed)", async () => {
    writeBundle(cwd, "step");
    writeFileSync(
      join(dir, "wf.yaml"),
      `name: wf
steps:
  - use: step
publish:
  - name: digest
    sh: |
      cat README.md
`,
    );

    const result = await loadWorkflows(dir, cwd);
    expect(Array.from(result.workflows.keys())).toEqual(["wf"]);
    expect(result.failures).toEqual([]);
  });

  it("records a failure when a publish use: entry references a missing bundle", async () => {
    writeBundle(cwd, "step");
    writeFileSync(
      join(dir, "wf.yaml"),
      `name: wf
steps:
  - use: step
publish:
  - name: digest
    use: ghost-writer
`,
    );

    const result = await loadWorkflows(dir, cwd);
    expect(result.workflows.size).toBe(0);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].path).toBe(join(dir, "wf.yaml"));
    expect(result.failures[0].reason).toContain('"ghost-writer"');
  });

  it("reports both step and summarize missing-bundle failures together", async () => {
    writeFileSync(
      join(dir, "wf.yaml"),
      `name: wf
steps:
  - use: ghost-step
summarize:
  use: ghost-summer
`,
    );

    const result = await loadWorkflows(dir, cwd);
    expect(result.workflows.size).toBe(0);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].reason).toContain('"ghost-step"');
    expect(result.failures[0].reason).toContain('"ghost-summer"');
  });

  it("uses the legacy nodes:/kind: shape as a validation failure with a clear error", async () => {
    writeFileSync(
      join(dir, "legacy.yaml"),
      `name: legacy
nodes:
  - kind: script
    path: scripts/legacy.sh
`,
    );

    const result = await loadWorkflows(dir, cwd);

    expect(result.workflows.size).toBe(0);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].path).toBe(join(dir, "legacy.yaml"));
    expect(result.failures[0].reason.length).toBeGreaterThan(0);
  });

  it("rejects a file that has both steps: and a stale nodes: at the top level", async () => {
    writeBundle(cwd, "x");
    writeFileSync(
      join(dir, "mixed.yaml"),
      `name: mixed
steps:
  - use: x
nodes:
  - kind: script
    path: scripts/x.sh
`,
    );

    const result = await loadWorkflows(dir, cwd);

    expect(result.workflows.size).toBe(0);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].path).toBe(join(dir, "mixed.yaml"));
  });

  it("records a failure when a YAML file can't be read", async () => {
    // Dangling symlink: readdir lists the entry, readFileSync fails ENOENT.
    symlinkSync("/nonexistent/kiri-loader-target", join(dir, "ghost.yaml"));

    const result = await loadWorkflows(dir, cwd);

    expect(result.workflows.size).toBe(0);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].path).toBe(join(dir, "ghost.yaml"));
    expect(result.failures[0].reason.length).toBeGreaterThan(0);
  });

  it("loads a workflow declaring inputs and referencing them from a step env", async () => {
    writeBundle(cwd, "fetch");
    writeFileSync(
      join(dir, "pr-review.yaml"),
      `name: pr-review
inputs:
  - name: pr_number
    description: PR to review
    required: true
steps:
  - use: fetch
    env:
      PR_NUMBER:
        input: pr_number
      MAX_RETRIES: "3"
`,
    );

    const result = await loadWorkflows(dir, cwd);
    expect(result.failures).toEqual([]);
    const wf = result.workflows.get("pr-review");
    expect(wf?.inputs).toEqual([
      { name: "pr_number", description: "PR to review", required: true },
    ]);
    expect(wf?.steps[0].env).toEqual({
      PR_NUMBER: { input: "pr_number" },
      MAX_RETRIES: "3",
    });
  });

  it("records a failure when a step env references an undeclared input", async () => {
    writeBundle(cwd, "fetch");
    writeFileSync(
      join(dir, "undeclared-ref.yaml"),
      `name: undeclared-ref
inputs:
  - name: pr_number
steps:
  - use: fetch
    env:
      TARGET:
        input: ghost
`,
    );

    const result = await loadWorkflows(dir, cwd);
    expect(result.workflows.size).toBe(0);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].path).toBe(join(dir, "undeclared-ref.yaml"));
    expect(result.failures[0].reason).toContain("ghost");
    expect(result.failures[0].reason).toContain("undeclared input");
  });

  it("records a failure when YAML parses but isn't an object", async () => {
    writeFileSync(join(dir, "scalar.yaml"), "just a string\n");

    const result = await loadWorkflows(dir, cwd);

    expect(result.workflows.size).toBe(0);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].path).toBe(join(dir, "scalar.yaml"));
  });

  it("throws when the directory does not exist", () => {
    const missing = join(dir, "does-not-exist");
    expect(loadWorkflows(missing, cwd)).rejects.toThrow();
  });
});
