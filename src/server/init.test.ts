import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ConfigStore, createConfigStore } from "./config/store.ts";
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
  let config: ConfigStore;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-schema-"));
    config = createConfigStore(cwd);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("creates .kiri/ and writes the JSON schema with a trailing newline", () => {
    const path = writeSchemaFile(config);
    expect(path).toBe(join(cwd, ".kiri", "workflow.schema.json"));
    const raw = readFileSync(path, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw)).toEqual(workflowJsonSchema());
  });

  it("overwrites an existing schema file (always refreshed)", () => {
    const path = writeSchemaFile(config);
    writeFileSync(path, '{ "stale": true }');
    writeSchemaFile(config);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(workflowJsonSchema());
  });
});

describe("writeLlmProvidersSchemaFile", () => {
  let cwd: string;
  let config: ConfigStore;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-llm-schema-"));
    config = createConfigStore(cwd);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("creates .kiri/ and writes the JSON schema with a trailing newline", () => {
    const path = writeLlmProvidersSchemaFile(config);
    expect(path).toBe(join(cwd, ".kiri", "llm-providers.schema.json"));
    const raw = readFileSync(path, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw)).toEqual(llmProvidersJsonSchema());
  });

  it("overwrites an existing schema file (always refreshed)", () => {
    const path = writeLlmProvidersSchemaFile(config);
    writeFileSync(path, '{ "stale": true }');
    writeLlmProvidersSchemaFile(config);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(llmProvidersJsonSchema());
  });
});

describe("initRepo", () => {
  let cwd: string;
  let config: ConfigStore;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-init-"));
    config = createConfigStore(cwd);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("scaffolds the README, hello-world workflow, and schema on a fresh repo", () => {
    const result = initRepo(config);

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
    initRepo(config);

    const { workflows, failures } = await loadWorkflows(createConfigStore(cwd));

    expect(failures).toEqual([]);
    expect([...workflows.keys()]).toEqual(["Hello World"]);
  });

  it("does not overwrite user-authored scaffold files on re-run", () => {
    initRepo(config);
    writeFileSync(join(cwd, "README.md"), "user notes");
    writeFileSync(join(cwd, "workflows", "hello-world.yaml"), "name: mine\nsteps: []\n");

    const result = initRepo(config);

    expect(readFileSync(join(cwd, "README.md"), "utf8")).toBe("user notes");
    expect(readFileSync(join(cwd, "workflows", "hello-world.yaml"), "utf8")).toBe(
      "name: mine\nsteps: []\n",
    );
    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual(["README.md", "workflows/hello-world.yaml"]);
  });

  it("always refreshes the schema files even when scaffold files are skipped", () => {
    initRepo(config);
    const schemaPath = join(cwd, ".kiri", "workflow.schema.json");
    const llmSchemaPath = join(cwd, ".kiri", "llm-providers.schema.json");
    writeFileSync(schemaPath, '{ "stale": true }');
    writeFileSync(llmSchemaPath, '{ "stale": true }');

    initRepo(config);
    expect(JSON.parse(readFileSync(schemaPath, "utf8"))).toEqual(workflowJsonSchema());
    expect(JSON.parse(readFileSync(llmSchemaPath, "utf8"))).toEqual(llmProvidersJsonSchema());
  });

  it("appends `.kiri/` to an existing .gitignore that doesn't list it", () => {
    writeFileSync(join(cwd, ".gitignore"), "node_modules\n");

    const result = initRepo(config);

    expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toBe("node_modules\n.kiri/\n");
    expect(result.gitignoreUpdated).toBe(true);
  });

  it("adds a trailing newline before appending if .gitignore lacks one", () => {
    writeFileSync(join(cwd, ".gitignore"), "node_modules");

    initRepo(config);

    expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toBe("node_modules\n.kiri/\n");
  });

  it("leaves .gitignore alone when `.kiri/` is already listed", () => {
    writeFileSync(join(cwd, ".gitignore"), "node_modules\n.kiri/\ndist\n");

    const result = initRepo(config);

    expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toBe("node_modules\n.kiri/\ndist\n");
    expect(result.gitignoreUpdated).toBe(false);
  });

  it("treats `.kiri` (no trailing slash) as already-listed", () => {
    writeFileSync(join(cwd, ".gitignore"), ".kiri\n");

    const result = initRepo(config);

    expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toBe(".kiri\n");
    expect(result.gitignoreUpdated).toBe(false);
  });

  it("creates .gitignore with `.kiri/` when one doesn't exist", () => {
    const result = initRepo(config);

    expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toBe(".kiri/\n");
    expect(result.gitignoreUpdated).toBe(true);
  });
});
