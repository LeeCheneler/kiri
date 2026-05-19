import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLAUDE_CODE_README,
  CLAUDE_CODE_RUN_SCRIPT,
  CLAUDE_CODE_SUMMARIZER_README,
  CLAUDE_CODE_SUMMARIZER_RUN_SCRIPT,
  HACKERNEWS_DIGEST_PROMPT,
  HACKERNEWS_DIGEST_WORKFLOW,
  KIRI_README,
  LM_STUDIO_README,
  LM_STUDIO_RUN_SCRIPT,
  LM_STUDIO_SUMMARIZER_README,
  LM_STUDIO_SUMMARIZER_RUN_SCRIPT,
  PR_REVIEW_QUEUE_WORKFLOW,
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

  it("scaffolds README, bundles, starter workflows, prompt template, and schema on a fresh repo", () => {
    const result = initRepo(cwd);

    expect(readFileSync(join(cwd, "README.md"), "utf8")).toBe(KIRI_README);
    expect(readFileSync(join(cwd, "scripts", "claude-code", "run.sh"), "utf8")).toBe(
      CLAUDE_CODE_RUN_SCRIPT,
    );
    expect(readFileSync(join(cwd, "scripts", "claude-code", "README.md"), "utf8")).toBe(
      CLAUDE_CODE_README,
    );
    expect(readFileSync(join(cwd, "scripts", "claude-code-summarizer", "run.sh"), "utf8")).toBe(
      CLAUDE_CODE_SUMMARIZER_RUN_SCRIPT,
    );
    expect(readFileSync(join(cwd, "scripts", "claude-code-summarizer", "README.md"), "utf8")).toBe(
      CLAUDE_CODE_SUMMARIZER_README,
    );
    expect(readFileSync(join(cwd, "scripts", "lm-studio", "run.sh"), "utf8")).toBe(
      LM_STUDIO_RUN_SCRIPT,
    );
    expect(readFileSync(join(cwd, "scripts", "lm-studio", "README.md"), "utf8")).toBe(
      LM_STUDIO_README,
    );
    expect(readFileSync(join(cwd, "scripts", "lm-studio-summarizer", "run.sh"), "utf8")).toBe(
      LM_STUDIO_SUMMARIZER_RUN_SCRIPT,
    );
    expect(readFileSync(join(cwd, "scripts", "lm-studio-summarizer", "README.md"), "utf8")).toBe(
      LM_STUDIO_SUMMARIZER_README,
    );
    expect(readFileSync(join(cwd, "workflows", "pr-review-queue.yaml"), "utf8")).toBe(
      PR_REVIEW_QUEUE_WORKFLOW,
    );
    expect(readFileSync(join(cwd, "workflows", "hackernews-digest.yaml"), "utf8")).toBe(
      HACKERNEWS_DIGEST_WORKFLOW,
    );
    expect(readFileSync(join(cwd, "prompts", "hackernews-digest.tpl"), "utf8")).toBe(
      HACKERNEWS_DIGEST_PROMPT,
    );
    expect(JSON.parse(readFileSync(join(cwd, ".kiri", "workflow.schema.json"), "utf8"))).toEqual(
      workflowJsonSchema(),
    );

    expect(result.created).toEqual([
      "README.md",
      "scripts/claude-code/run.sh",
      "scripts/claude-code/README.md",
      "scripts/claude-code-summarizer/run.sh",
      "scripts/claude-code-summarizer/README.md",
      "scripts/lm-studio/run.sh",
      "scripts/lm-studio/README.md",
      "scripts/lm-studio-summarizer/run.sh",
      "scripts/lm-studio-summarizer/README.md",
      "workflows/pr-review-queue.yaml",
      "workflows/hackernews-digest.yaml",
      "prompts/hackernews-digest.tpl",
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.schemaPath).toBe(".kiri/workflow.schema.json");
  });

  it("marks the scaffolded claude-code bundle's run.sh as executable", () => {
    initRepo(cwd);
    const mode = statSync(join(cwd, "scripts", "claude-code", "run.sh")).mode & 0o777;
    expect(mode & 0o111).not.toBe(0);
  });

  it("marks the scaffolded claude-code-summarizer bundle's run.sh as executable", () => {
    initRepo(cwd);
    const mode = statSync(join(cwd, "scripts", "claude-code-summarizer", "run.sh")).mode & 0o777;
    expect(mode & 0o111).not.toBe(0);
  });

  it("marks the scaffolded lm-studio bundle's run.sh as executable", () => {
    initRepo(cwd);
    const mode = statSync(join(cwd, "scripts", "lm-studio", "run.sh")).mode & 0o777;
    expect(mode & 0o111).not.toBe(0);
  });

  it("marks the scaffolded lm-studio-summarizer bundle's run.sh as executable", () => {
    initRepo(cwd);
    const mode = statSync(join(cwd, "scripts", "lm-studio-summarizer", "run.sh")).mode & 0o777;
    expect(mode & 0o111).not.toBe(0);
  });

  it("does not overwrite user-authored scaffold files on re-run", () => {
    initRepo(cwd);
    writeFileSync(join(cwd, "README.md"), "user notes");
    writeFileSync(join(cwd, "scripts", "claude-code", "run.sh"), "#!/bin/sh\necho mine-cc\n");
    writeFileSync(join(cwd, "scripts", "claude-code", "README.md"), "user cc notes");
    writeFileSync(
      join(cwd, "scripts", "claude-code-summarizer", "run.sh"),
      "#!/bin/sh\necho mine-summer\n",
    );
    writeFileSync(join(cwd, "scripts", "claude-code-summarizer", "README.md"), "user summer notes");
    writeFileSync(join(cwd, "scripts", "lm-studio", "run.sh"), "#!/bin/sh\necho mine-lms\n");
    writeFileSync(join(cwd, "scripts", "lm-studio", "README.md"), "user lms notes");
    writeFileSync(
      join(cwd, "scripts", "lm-studio-summarizer", "run.sh"),
      "#!/bin/sh\necho mine-lms-summer\n",
    );
    writeFileSync(
      join(cwd, "scripts", "lm-studio-summarizer", "README.md"),
      "user lms summer notes",
    );
    writeFileSync(join(cwd, "workflows", "pr-review-queue.yaml"), "name: user-prs\nsteps: []\n");
    writeFileSync(join(cwd, "workflows", "hackernews-digest.yaml"), "name: user-hn\nsteps: []\n");
    writeFileSync(join(cwd, "prompts", "hackernews-digest.tpl"), "user prompt");

    const result = initRepo(cwd);

    expect(readFileSync(join(cwd, "README.md"), "utf8")).toBe("user notes");
    expect(readFileSync(join(cwd, "scripts", "claude-code", "run.sh"), "utf8")).toBe(
      "#!/bin/sh\necho mine-cc\n",
    );
    expect(readFileSync(join(cwd, "scripts", "claude-code", "README.md"), "utf8")).toBe(
      "user cc notes",
    );
    expect(readFileSync(join(cwd, "scripts", "claude-code-summarizer", "run.sh"), "utf8")).toBe(
      "#!/bin/sh\necho mine-summer\n",
    );
    expect(readFileSync(join(cwd, "scripts", "claude-code-summarizer", "README.md"), "utf8")).toBe(
      "user summer notes",
    );
    expect(readFileSync(join(cwd, "scripts", "lm-studio", "run.sh"), "utf8")).toBe(
      "#!/bin/sh\necho mine-lms\n",
    );
    expect(readFileSync(join(cwd, "scripts", "lm-studio", "README.md"), "utf8")).toBe(
      "user lms notes",
    );
    expect(readFileSync(join(cwd, "scripts", "lm-studio-summarizer", "run.sh"), "utf8")).toBe(
      "#!/bin/sh\necho mine-lms-summer\n",
    );
    expect(readFileSync(join(cwd, "scripts", "lm-studio-summarizer", "README.md"), "utf8")).toBe(
      "user lms summer notes",
    );
    expect(readFileSync(join(cwd, "workflows", "pr-review-queue.yaml"), "utf8")).toBe(
      "name: user-prs\nsteps: []\n",
    );
    expect(readFileSync(join(cwd, "workflows", "hackernews-digest.yaml"), "utf8")).toBe(
      "name: user-hn\nsteps: []\n",
    );
    expect(readFileSync(join(cwd, "prompts", "hackernews-digest.tpl"), "utf8")).toBe("user prompt");
    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual([
      "README.md",
      "scripts/claude-code/run.sh",
      "scripts/claude-code/README.md",
      "scripts/claude-code-summarizer/run.sh",
      "scripts/claude-code-summarizer/README.md",
      "scripts/lm-studio/run.sh",
      "scripts/lm-studio/README.md",
      "scripts/lm-studio-summarizer/run.sh",
      "scripts/lm-studio-summarizer/README.md",
      "workflows/pr-review-queue.yaml",
      "workflows/hackernews-digest.yaml",
      "prompts/hackernews-digest.tpl",
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
// the claude-code + summarizer bundles are checked in alongside the
// init scaffold constants. If anyone edits one without the other,
// fail fast — the constant is the source of truth.
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

  it("scripts/claude-code-summarizer/run.sh matches CLAUDE_CODE_SUMMARIZER_RUN_SCRIPT", () => {
    const tracked = readFileSync(
      join(repoRoot, "scripts", "claude-code-summarizer", "run.sh"),
      "utf8",
    );
    expect(tracked).toBe(CLAUDE_CODE_SUMMARIZER_RUN_SCRIPT);
  });

  it("scripts/claude-code-summarizer/README.md matches CLAUDE_CODE_SUMMARIZER_README", () => {
    const tracked = readFileSync(
      join(repoRoot, "scripts", "claude-code-summarizer", "README.md"),
      "utf8",
    );
    expect(tracked).toBe(CLAUDE_CODE_SUMMARIZER_README);
  });

  it("scripts/lm-studio/run.sh matches LM_STUDIO_RUN_SCRIPT", () => {
    const tracked = readFileSync(join(repoRoot, "scripts", "lm-studio", "run.sh"), "utf8");
    expect(tracked).toBe(LM_STUDIO_RUN_SCRIPT);
  });

  it("scripts/lm-studio/README.md matches LM_STUDIO_README", () => {
    const tracked = readFileSync(join(repoRoot, "scripts", "lm-studio", "README.md"), "utf8");
    expect(tracked).toBe(LM_STUDIO_README);
  });

  it("scripts/lm-studio-summarizer/run.sh matches LM_STUDIO_SUMMARIZER_RUN_SCRIPT", () => {
    const tracked = readFileSync(
      join(repoRoot, "scripts", "lm-studio-summarizer", "run.sh"),
      "utf8",
    );
    expect(tracked).toBe(LM_STUDIO_SUMMARIZER_RUN_SCRIPT);
  });

  it("scripts/lm-studio-summarizer/README.md matches LM_STUDIO_SUMMARIZER_README", () => {
    const tracked = readFileSync(
      join(repoRoot, "scripts", "lm-studio-summarizer", "README.md"),
      "utf8",
    );
    expect(tracked).toBe(LM_STUDIO_SUMMARIZER_README);
  });

  it("workflows/pr-review-queue.yaml matches PR_REVIEW_QUEUE_WORKFLOW", () => {
    const tracked = readFileSync(join(repoRoot, "workflows", "pr-review-queue.yaml"), "utf8");
    expect(tracked).toBe(PR_REVIEW_QUEUE_WORKFLOW);
  });

  it("workflows/hackernews-digest.yaml matches HACKERNEWS_DIGEST_WORKFLOW", () => {
    const tracked = readFileSync(join(repoRoot, "workflows", "hackernews-digest.yaml"), "utf8");
    expect(tracked).toBe(HACKERNEWS_DIGEST_WORKFLOW);
  });

  it("prompts/hackernews-digest.tpl matches HACKERNEWS_DIGEST_PROMPT", () => {
    const tracked = readFileSync(join(repoRoot, "prompts", "hackernews-digest.tpl"), "utf8");
    expect(tracked).toBe(HACKERNEWS_DIGEST_PROMPT);
  });
});
