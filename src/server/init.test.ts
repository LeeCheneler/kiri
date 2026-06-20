import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kiriConfigJsonSchema } from "./config/json-schema.ts";
import { type ConfigStore, createConfigStore } from "./config/store.ts";
import {
  DEFAULT_KIRI_CONFIG,
  HELLO_WORLD_WORKFLOW,
  KIRI_README,
  initRepo,
  writeDefaultConfig,
  writeKiriConfigSchemaFile,
  writeSchemaFile,
} from "./init.ts";
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

describe("writeKiriConfigSchemaFile", () => {
  let cwd: string;
  let config: ConfigStore;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-config-schema-"));
    config = createConfigStore(cwd);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("creates .kiri/ and writes the JSON schema with a trailing newline", () => {
    const path = writeKiriConfigSchemaFile(config);
    expect(path).toBe(join(cwd, ".kiri", "kiri.schema.json"));
    const raw = readFileSync(path, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw)).toEqual(kiriConfigJsonSchema());
  });

  it("overwrites an existing schema file (always refreshed)", () => {
    const path = writeKiriConfigSchemaFile(config);
    writeFileSync(path, '{ "stale": true }');
    writeKiriConfigSchemaFile(config);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(kiriConfigJsonSchema());
  });
});

describe("writeDefaultConfig", () => {
  let cwd: string;
  let config: ConfigStore;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-default-config-"));
    config = createConfigStore(cwd);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("writes a commented default kiri.yaml when no config file exists", () => {
    expect(writeDefaultConfig(config)).toBe(true);
    expect(readFileSync(join(cwd, "kiri.yaml"), "utf8")).toBe(DEFAULT_KIRI_CONFIG);
  });

  it("does not overwrite an existing kiri.yaml", () => {
    writeFileSync(join(cwd, "kiri.yaml"), "providers: {}\n");
    expect(writeDefaultConfig(config)).toBe(false);
    expect(readFileSync(join(cwd, "kiri.yaml"), "utf8")).toBe("providers: {}\n");
  });

  it("does not create kiri.yaml when a kiri.yml already exists", () => {
    writeFileSync(join(cwd, "kiri.yml"), "providers: {}\n");
    expect(writeDefaultConfig(config)).toBe(false);
    expect(existsSync(join(cwd, "kiri.yaml"))).toBe(false);
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
    expect(JSON.parse(readFileSync(join(cwd, ".kiri", "kiri.schema.json"), "utf8"))).toEqual(
      kiriConfigJsonSchema(),
    );
    expect(readFileSync(join(cwd, "kiri.yaml"), "utf8")).toBe(DEFAULT_KIRI_CONFIG);

    expect(result.created).toEqual(["README.md", "workflows/hello-world.yaml", "kiri.yaml"]);
    expect(result.skipped).toEqual([]);
    expect(result.schemaPath).toBe(".kiri/workflow.schema.json");
    expect(result.configSchemaPath).toBe(".kiri/kiri.schema.json");
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
    expect(result.skipped).toEqual(["README.md", "workflows/hello-world.yaml", "kiri.yaml"]);
  });

  it("always refreshes the schema files even when scaffold files are skipped", () => {
    initRepo(config);
    const schemaPath = join(cwd, ".kiri", "workflow.schema.json");
    const configSchemaPath = join(cwd, ".kiri", "kiri.schema.json");
    writeFileSync(schemaPath, '{ "stale": true }');
    writeFileSync(configSchemaPath, '{ "stale": true }');

    initRepo(config);
    expect(JSON.parse(readFileSync(schemaPath, "utf8"))).toEqual(workflowJsonSchema());
    expect(JSON.parse(readFileSync(configSchemaPath, "utf8"))).toEqual(kiriConfigJsonSchema());
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
