import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HELLO_WORLD_WORKFLOW,
  KIRI_README,
  initRepo,
  writeLlmProvidersSchemaFile,
  writeSchemaFile,
} from "./init.ts";
import { llmProvidersJsonSchema } from "./llm/index.ts";
import { loadWorkflows, workflowJsonSchema } from "./workflows/index.ts";

describe("writeSchemaFile", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-schema-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("creates .kiri/ and writes the JSON schema with a trailing newline", () => {
    const path = writeSchemaFile(cwd);
    expect(path).toBe(join(cwd, ".kiri", "workflow.schema.json"));
    const raw = readFileSync(path, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw)).toEqual(workflowJsonSchema());
  });

  it("overwrites an existing schema file (always refreshed)", () => {
    const path = writeSchemaFile(cwd);
    writeFileSync(path, '{ "stale": true }');
    writeSchemaFile(cwd);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(workflowJsonSchema());
  });
});

describe("writeLlmProvidersSchemaFile", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-llm-schema-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("creates .kiri/ and writes the JSON schema with a trailing newline", () => {
    const path = writeLlmProvidersSchemaFile(cwd);
    expect(path).toBe(join(cwd, ".kiri", "llm-providers.schema.json"));
    const raw = readFileSync(path, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw)).toEqual(llmProvidersJsonSchema());
  });

  it("overwrites an existing schema file (always refreshed)", () => {
    const path = writeLlmProvidersSchemaFile(cwd);
    writeFileSync(path, '{ "stale": true }');
    writeLlmProvidersSchemaFile(cwd);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(llmProvidersJsonSchema());
  });
});

describe("initRepo", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-init-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("scaffolds the README, hello-world workflow, and schema on a fresh repo", () => {
    const result = initRepo(cwd);

    expect(readFileSync(join(cwd, "README.md"), "utf8")).toBe(KIRI_README);
    expect(readFileSync(join(cwd, "workflows", "hello-world.yaml"), "utf8")).toBe(
      HELLO_WORLD_WORKFLOW,
    );
    expect(JSON.parse(readFileSync(join(cwd, ".kiri", "workflow.schema.json"), "utf8"))).toEqual(
      workflowJsonSchema(),
    );
    expect(
      JSON.parse(readFileSync(join(cwd, ".kiri", "llm-providers.schema.json"), "utf8")),
    ).toEqual(llmProvidersJsonSchema());

    expect(result.created).toEqual(["README.md", "workflows/hello-world.yaml"]);
    expect(result.skipped).toEqual([]);
    expect(result.schemaPath).toBe(".kiri/workflow.schema.json");
    expect(result.llmSchemaPath).toBe(".kiri/llm-providers.schema.json");
  });

  it("scaffolds a hello-world workflow that loads without failures", async () => {
    initRepo(cwd);

    const { workflows, failures } = await loadWorkflows(join(cwd, "workflows"), cwd);

    expect(failures).toEqual([]);
    expect([...workflows.keys()]).toEqual(["Hello World"]);
  });

  it("does not overwrite user-authored scaffold files on re-run", () => {
    initRepo(cwd);
    writeFileSync(join(cwd, "README.md"), "user notes");
    writeFileSync(join(cwd, "workflows", "hello-world.yaml"), "name: mine\nsteps: []\n");

    const result = initRepo(cwd);

    expect(readFileSync(join(cwd, "README.md"), "utf8")).toBe("user notes");
    expect(readFileSync(join(cwd, "workflows", "hello-world.yaml"), "utf8")).toBe(
      "name: mine\nsteps: []\n",
    );
    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual(["README.md", "workflows/hello-world.yaml"]);
  });

  it("always refreshes the schema files even when scaffold files are skipped", () => {
    initRepo(cwd);
    const schemaPath = join(cwd, ".kiri", "workflow.schema.json");
    const llmSchemaPath = join(cwd, ".kiri", "llm-providers.schema.json");
    writeFileSync(schemaPath, '{ "stale": true }');
    writeFileSync(llmSchemaPath, '{ "stale": true }');

    initRepo(cwd);
    expect(JSON.parse(readFileSync(schemaPath, "utf8"))).toEqual(workflowJsonSchema());
    expect(JSON.parse(readFileSync(llmSchemaPath, "utf8"))).toEqual(llmProvidersJsonSchema());
  });

  it("appends `.kiri/` to an existing .gitignore that doesn't list it", () => {
    writeFileSync(join(cwd, ".gitignore"), "node_modules\n");

    const result = initRepo(cwd);

    expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toBe("node_modules\n.kiri/\n");
    expect(result.gitignoreUpdated).toBe(true);
  });

  it("adds a trailing newline before appending if .gitignore lacks one", () => {
    writeFileSync(join(cwd, ".gitignore"), "node_modules");

    initRepo(cwd);

    expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toBe("node_modules\n.kiri/\n");
  });

  it("leaves .gitignore alone when `.kiri/` is already listed", () => {
    writeFileSync(join(cwd, ".gitignore"), "node_modules\n.kiri/\ndist\n");

    const result = initRepo(cwd);

    expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toBe("node_modules\n.kiri/\ndist\n");
    expect(result.gitignoreUpdated).toBe(false);
  });

  it("treats `.kiri` (no trailing slash) as already-listed", () => {
    writeFileSync(join(cwd, ".gitignore"), ".kiri\n");

    const result = initRepo(cwd);

    expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toBe(".kiri\n");
    expect(result.gitignoreUpdated).toBe(false);
  });

  it("creates .gitignore with `.kiri/` when one doesn't exist", () => {
    const result = initRepo(cwd);

    expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toBe(".kiri/\n");
    expect(result.gitignoreUpdated).toBe(true);
  });
});
