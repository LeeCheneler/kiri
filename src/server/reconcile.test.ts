import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { bootstrap } from "./bootstrap.ts";
import type { KiriDb } from "./db/index.ts";
import { runNodes, runs } from "./db/schema.ts";
import { reconcileInterruptedRuns } from "./reconcile.ts";

describe("reconcileInterruptedRuns", () => {
  let cwd: string;
  let db: KiriDb;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-reconcile-"));
    db = bootstrap(cwd);
  });

  afterEach(() => {
    db.$client.close();
    rmSync(cwd, { recursive: true, force: true });
  });

  const insertRun = (id: string, status: "running" | "ok" | "failed") => {
    db.insert(runs)
      .values({
        id,
        workflowName: "wf",
        status,
        trigger: "manual",
        startedAt: new Date(0),
        finishedAt: status === "running" ? null : new Date(0),
        definitionSnapshot: { name: "wf", nodes: [] },
      })
      .run();
  };

  const insertNode = (id: string, runId: string, status: "running" | "ok" | "failed") => {
    db.insert(runNodes)
      .values({
        id,
        runId,
        index: 0,
        kind: "script",
        status,
        materials: { source: "" },
      })
      .run();
  };

  it("marks stuck running runs as failed with finishedAt and an interrupted error", () => {
    insertRun("stuck", "running");

    reconcileInterruptedRuns(db);

    const row = db.select().from(runs).where(eq(runs.id, "stuck")).get();
    expect(row?.status).toBe("failed");
    expect(row?.finishedAt).toBeInstanceOf(Date);
    expect(row?.error).toEqual({ message: "interrupted by server restart" });
  });

  it("marks stuck running run_nodes as failed with an interrupted error", () => {
    insertRun("r1", "running");
    insertNode("n1", "r1", "running");

    reconcileInterruptedRuns(db);

    const node = db.select().from(runNodes).where(eq(runNodes.id, "n1")).get();
    expect(node?.status).toBe("failed");
    expect(node?.error).toEqual({ message: "interrupted by server restart" });
  });

  it("leaves rows in terminal states untouched", () => {
    insertRun("done", "ok");
    insertRun("broke", "failed");
    insertNode("done-node", "done", "ok");
    insertNode("broke-node", "broke", "failed");

    reconcileInterruptedRuns(db);

    expect(db.select().from(runs).where(eq(runs.id, "done")).get()?.status).toBe("ok");
    expect(db.select().from(runs).where(eq(runs.id, "broke")).get()?.status).toBe("failed");
    expect(db.select().from(runNodes).where(eq(runNodes.id, "done-node")).get()?.status).toBe("ok");
    expect(db.select().from(runNodes).where(eq(runNodes.id, "broke-node")).get()?.status).toBe(
      "failed",
    );
  });

  it("is a no-op when called repeatedly with no running rows", () => {
    insertRun("done", "ok");

    reconcileInterruptedRuns(db);
    reconcileInterruptedRuns(db);

    const row = db.select().from(runs).where(eq(runs.id, "done")).get();
    expect(row?.status).toBe("ok");
    expect(row?.error).toBeNull();
  });
});
