import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asc, eq } from "drizzle-orm";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { recommendations, runs } from "../db/schema.ts";
import { ingestStepRecommendations } from "./recommendations.ts";

describe("ingestStepRecommendations", () => {
  let dir: string;
  let db: KiriDb;
  const runId = "run-test";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-rec-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
    db.insert(runs)
      .values({
        id: runId,
        workflowName: "wf",
        status: "ok",
        trigger: "manual",
        startedAt: new Date(),
        definitionSnapshot: {},
      })
      .run();
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const withSilencedWarn = <T>(fn: () => T): { result: T; warnings: string[] } => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (msg: unknown) => {
      warnings.push(String(msg));
    };
    try {
      return { result: fn(), warnings };
    } finally {
      console.warn = original;
    }
  };

  const writeLines = (lines: string[]): string => {
    const path = join(dir, "recommendations.jsonl");
    writeFileSync(path, `${lines.join("\n")}\n`);
    return path;
  };

  const allRows = () =>
    db
      .select()
      .from(recommendations)
      .where(eq(recommendations.runId, runId))
      .orderBy(asc(recommendations.index))
      .all();

  it("returns the starting index unchanged when the file does not exist", () => {
    expect(ingestStepRecommendations(db, runId, join(dir, "missing.jsonl"), 4)).toBe(4);
    expect(allRows()).toHaveLength(0);
  });

  it("returns the starting index unchanged on an empty file", () => {
    const path = writeLines([]);
    expect(ingestStepRecommendations(db, runId, path, 7)).toBe(7);
    expect(allRows()).toHaveLength(0);
  });

  it("skips whitespace-only lines without inserting or advancing the index", () => {
    const path = writeLines(["", "   ", "\t"]);
    expect(ingestStepRecommendations(db, runId, path, 0)).toBe(0);
    expect(allRows()).toHaveLength(0);
  });

  it("inserts a fully-populated line and returns the next index", () => {
    const path = writeLines([
      JSON.stringify({
        title: "Review PR #42",
        workflow: "pr-review",
        description: "+10/-2 fix the thing",
        inputs: { pr_number: "42" },
      }),
    ]);

    expect(ingestStepRecommendations(db, runId, path, 0)).toBe(1);

    const rows = allRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      runId,
      index: 0,
      title: "Review PR #42",
      description: "+10/-2 fix the thing",
      workflow: "pr-review",
      inputs: { pr_number: "42" },
      actionedRunId: null,
      actionedAt: null,
    });
  });

  it("honours the supplied starting index and assigns consecutive values", () => {
    const path = writeLines([
      JSON.stringify({ title: "A", workflow: "w" }),
      JSON.stringify({ title: "B", workflow: "w" }),
      JSON.stringify({ title: "C", workflow: "w" }),
    ]);

    expect(ingestStepRecommendations(db, runId, path, 5)).toBe(8);

    expect(allRows().map((r) => ({ index: r.index, title: r.title }))).toEqual([
      { index: 5, title: "A" },
      { index: 6, title: "B" },
      { index: 7, title: "C" },
    ]);
  });

  it("skips a malformed JSON line, warns, and does not advance the index for it", () => {
    const path = writeLines([
      JSON.stringify({ title: "Before", workflow: "w" }),
      "{ not json",
      JSON.stringify({ title: "After", workflow: "w" }),
    ]);

    const { result, warnings } = withSilencedWarn(() =>
      ingestStepRecommendations(db, runId, path, 0),
    );

    expect(result).toBe(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("malformed recommendation");
    expect(warnings[0]).toContain(runId);
    expect(allRows().map((r) => ({ index: r.index, title: r.title }))).toEqual([
      { index: 0, title: "Before" },
      { index: 1, title: "After" },
    ]);
  });

  it("skips a schema-failing line, warns, and does not advance the index for it", () => {
    const path = writeLines([
      JSON.stringify({ title: "Before", workflow: "w" }),
      JSON.stringify({ title: "Missing workflow" }),
      JSON.stringify({ title: "After", workflow: "w" }),
    ]);

    const { result, warnings } = withSilencedWarn(() =>
      ingestStepRecommendations(db, runId, path, 0),
    );

    expect(result).toBe(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("failing schema");
    expect(warnings[0]).toContain(runId);
    expect(allRows().map((r) => ({ index: r.index, title: r.title }))).toEqual([
      { index: 0, title: "Before" },
      { index: 1, title: "After" },
    ]);
  });

  it("treats an empty string title and empty description as schema failures", () => {
    const path = writeLines([
      JSON.stringify({ title: "", workflow: "w" }),
      JSON.stringify({ title: "ok", workflow: "w", description: "" }),
      JSON.stringify({ title: "kept", workflow: "w" }),
    ]);

    const { result, warnings } = withSilencedWarn(() =>
      ingestStepRecommendations(db, runId, path, 0),
    );

    expect(result).toBe(1);
    expect(warnings).toHaveLength(2);
    expect(allRows().map((r) => r.title)).toEqual(["kept"]);
  });
});
