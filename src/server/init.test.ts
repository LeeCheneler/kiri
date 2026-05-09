import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLAUDE_CODE_README,
  CLAUDE_CODE_RUN_SCRIPT,
  EXAMPLE_PROMPT_TPL,
  EXAMPLE_WORKFLOW_YAML,
  KIRI_README,
  initRepo,
  writeSchemaFile,
} from "./init.ts";
import { workflowJsonSchema } from "./workflows/index.ts";

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

describe("initRepo", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-init-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("scaffolds README, example workflow + prompt, claude-code bundle, and schema on a fresh repo", () => {
    const result = initRepo(cwd);

    expect(readFileSync(join(cwd, "README.md"), "utf8")).toBe(KIRI_README);
    expect(readFileSync(join(cwd, "workflows", "example.yaml"), "utf8")).toBe(
      EXAMPLE_WORKFLOW_YAML,
    );
    expect(readFileSync(join(cwd, "prompts", "example.tpl"), "utf8")).toBe(EXAMPLE_PROMPT_TPL);
    expect(readFileSync(join(cwd, "scripts", "claude-code", "run.sh"), "utf8")).toBe(
      CLAUDE_CODE_RUN_SCRIPT,
    );
    expect(readFileSync(join(cwd, "scripts", "claude-code", "README.md"), "utf8")).toBe(
      CLAUDE_CODE_README,
    );
    expect(JSON.parse(readFileSync(join(cwd, ".kiri", "workflow.schema.json"), "utf8"))).toEqual(
      workflowJsonSchema(),
    );

    expect(result.created).toEqual([
      "README.md",
      "workflows/example.yaml",
      "prompts/example.tpl",
      "scripts/claude-code/run.sh",
      "scripts/claude-code/README.md",
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.schemaPath).toBe(".kiri/workflow.schema.json");
  });

  it("marks the scaffolded claude-code bundle's run.sh as executable", () => {
    initRepo(cwd);
    const mode = statSync(join(cwd, "scripts", "claude-code", "run.sh")).mode & 0o777;
    expect(mode & 0o111).not.toBe(0);
  });

  it("does not overwrite user-authored scaffold files on re-run", () => {
    initRepo(cwd);
    writeFileSync(join(cwd, "README.md"), "user notes");
    writeFileSync(join(cwd, "workflows", "example.yaml"), "name: mine\nsteps: []\n");
    writeFileSync(join(cwd, "prompts", "example.tpl"), "user prompt");
    writeFileSync(join(cwd, "scripts", "claude-code", "run.sh"), "#!/bin/sh\necho mine-cc\n");
    writeFileSync(join(cwd, "scripts", "claude-code", "README.md"), "user cc notes");

    const result = initRepo(cwd);

    expect(readFileSync(join(cwd, "README.md"), "utf8")).toBe("user notes");
    expect(readFileSync(join(cwd, "workflows", "example.yaml"), "utf8")).toBe(
      "name: mine\nsteps: []\n",
    );
    expect(readFileSync(join(cwd, "prompts", "example.tpl"), "utf8")).toBe("user prompt");
    expect(readFileSync(join(cwd, "scripts", "claude-code", "run.sh"), "utf8")).toBe(
      "#!/bin/sh\necho mine-cc\n",
    );
    expect(readFileSync(join(cwd, "scripts", "claude-code", "README.md"), "utf8")).toBe(
      "user cc notes",
    );
    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual([
      "README.md",
      "workflows/example.yaml",
      "prompts/example.tpl",
      "scripts/claude-code/run.sh",
      "scripts/claude-code/README.md",
    ]);
  });

  it("always refreshes the schema file even when scaffold files are skipped", () => {
    initRepo(cwd);
    const schemaPath = join(cwd, ".kiri", "workflow.schema.json");
    writeFileSync(schemaPath, '{ "stale": true }');

    initRepo(cwd);
    expect(JSON.parse(readFileSync(schemaPath, "utf8"))).toEqual(workflowJsonSchema());
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

// Drift guard: this repo runs as a consumer of its own `kiri init` —
// the example workflow + prompt + claude-code bundle are checked in
// alongside the init scaffold constants. If anyone edits one without
// the other, fail fast — the constant is the source of truth.
describe("checked-in init artifacts (dogfood drift guard)", () => {
  const repoRoot = join(import.meta.dir, "..", "..");

  it("scripts/claude-code/run.sh matches CLAUDE_CODE_RUN_SCRIPT", () => {
    const tracked = readFileSync(join(repoRoot, "scripts", "claude-code", "run.sh"), "utf8");
    expect(tracked).toBe(CLAUDE_CODE_RUN_SCRIPT);
  });

  it("scripts/claude-code/README.md matches CLAUDE_CODE_README", () => {
    const tracked = readFileSync(join(repoRoot, "scripts", "claude-code", "README.md"), "utf8");
    expect(tracked).toBe(CLAUDE_CODE_README);
  });

  it("workflows/example.yaml matches EXAMPLE_WORKFLOW_YAML", () => {
    const tracked = readFileSync(join(repoRoot, "workflows", "example.yaml"), "utf8");
    expect(tracked).toBe(EXAMPLE_WORKFLOW_YAML);
  });

  it("prompts/example.tpl matches EXAMPLE_PROMPT_TPL", () => {
    const tracked = readFileSync(join(repoRoot, "prompts", "example.tpl"), "utf8");
    expect(tracked).toBe(EXAMPLE_PROMPT_TPL);
  });
});
