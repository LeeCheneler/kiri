import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { asc, eq } from "drizzle-orm";
import { bootstrap } from "../bootstrap.ts";
import type { KiriDb } from "../db/index.ts";
import { runNodes, runs } from "../db/schema.ts";
import type { WorkflowDefinition } from "../workflows/index.ts";
import { runWorkflow } from "./run-workflow.ts";

describe("runWorkflow", () => {
  let cwd: string;
  let db: KiriDb;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-runner-"));
    db = bootstrap(cwd);
  });

  afterEach(() => {
    db.$client.close();
    rmSync(cwd, { recursive: true, force: true });
  });

  const writeScript = (relPath: string, body: string): string => {
    const abs = join(cwd, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
    chmodSync(abs, 0o755);
    return abs;
  };

  const makeWorkflow = (name: string, nodePaths: string[]): WorkflowDefinition => ({
    name,
    nodes: nodePaths.map((path) => ({ kind: "script" as const, path })),
  });

  it("persists a single-node run + envelope and reports ok", async () => {
    writeScript("scripts/hello.sh", "#!/bin/sh\necho hi from kiri\n");
    const wf = makeWorkflow("greeter", ["scripts/hello.sh"]);

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });

    expect(result.status).toBe("ok");

    const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
    expect(run?.workflowName).toBe("greeter");
    expect(run?.status).toBe("ok");
    expect(run?.trigger).toBe("manual");
    expect(run?.startedAt).toBeInstanceOf(Date);
    expect(run?.finishedAt).toBeInstanceOf(Date);
    expect(run?.error).toBeNull();

    const nodeRows = db.select().from(runNodes).where(eq(runNodes.runId, result.runId)).all();
    expect(nodeRows).toHaveLength(1);
    const node = nodeRows[0];
    expect(node.index).toBe(0);
    expect(node.kind).toBe("script");
    expect(node.status).toBe("ok");
    expect(node.output).toBe("hi from kiri\n");
    expect(node.materials).toEqual({ source: "#!/bin/sh\necho hi from kiri\n" });
    expect(node.error).toBeNull();
    expect(node.traces).toMatchObject({ stdout: "hi from kiri\n", stderr: "" });
  });

  it("pipes node output to the next node's stdin", async () => {
    writeScript("scripts/emit.sh", "#!/bin/sh\necho first-output\n");
    writeScript("scripts/cat.sh", "#!/bin/sh\ncat\n");
    const wf = makeWorkflow("pipe", ["scripts/emit.sh", "scripts/cat.sh"]);

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });

    expect(result.status).toBe("ok");
    const nodes = db
      .select()
      .from(runNodes)
      .where(eq(runNodes.runId, result.runId))
      .orderBy(asc(runNodes.index))
      .all();
    expect(nodes).toHaveLength(2);
    expect(nodes[0].output).toBe("first-output\n");
    // cat echoes node 0's stdout it received on stdin.
    expect(nodes[1].output).toBe("first-output\n");
  });

  it("halts on first failure and does not create rows for later nodes", async () => {
    writeScript("scripts/boom.sh", "#!/bin/sh\necho before-fail\nexit 5\n");
    writeScript("scripts/wont-run.sh", "#!/bin/sh\necho should-not-run\n");
    const wf = makeWorkflow("halts", ["scripts/boom.sh", "scripts/wont-run.sh"]);

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });

    expect(result.status).toBe("failed");

    const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
    expect(run?.status).toBe("failed");
    expect(run?.error).not.toBeNull();
    expect(run?.finishedAt).toBeInstanceOf(Date);

    const nodes = db.select().from(runNodes).where(eq(runNodes.runId, result.runId)).all();
    expect(nodes).toHaveLength(1);
    expect(nodes[0].status).toBe("failed");
    expect(nodes[0].error).not.toBeNull();
  });

  it("captures script source at run start; later edits don't change the snapshot", async () => {
    const scriptPath = writeScript("scripts/v.sh", "#!/bin/sh\necho v1\n");
    const wf = makeWorkflow("snap", ["scripts/v.sh"]);

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });
    writeFileSync(scriptPath, "#!/bin/sh\necho v2\n");

    const node = db.select().from(runNodes).where(eq(runNodes.runId, result.runId)).get();
    expect(node?.materials).toEqual({ source: "#!/bin/sh\necho v1\n" });
  });

  it("snapshots the resolved definition onto the run row", async () => {
    writeScript("scripts/n.sh", "#!/bin/sh\necho hi\n");
    const wf: WorkflowDefinition = {
      name: "snapshot",
      nodes: [{ kind: "script", path: "scripts/n.sh" }],
      gating: "auto",
      schedule: "*/5 * * * *",
    };

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });

    const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
    expect(run?.definitionSnapshot).toEqual({
      name: "snapshot",
      nodes: [{ kind: "script", path: "scripts/n.sh" }],
      gating: "auto",
      schedule: "*/5 * * * *",
    });
  });

  it("removes the scratch dir after a successful run", async () => {
    writeScript("scripts/ok.sh", "#!/bin/sh\necho ok\n");
    const wf = makeWorkflow("clean-ok", ["scripts/ok.sh"]);

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });

    expect(existsSync(join(cwd, ".kiri", "runs", result.runId))).toBe(false);
  });

  it("removes the scratch dir after a failed run", async () => {
    writeScript("scripts/fail.sh", "#!/bin/sh\nexit 1\n");
    const wf = makeWorkflow("clean-fail", ["scripts/fail.sh"]);

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });

    expect(result.status).toBe("failed");
    expect(existsSync(join(cwd, ".kiri", "runs", result.runId))).toBe(false);
  });

  it("fails the node when the script file is missing", async () => {
    const wf = makeWorkflow("missing", ["scripts/does-not-exist.sh"]);

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });

    expect(result.status).toBe("failed");
    const node = db.select().from(runNodes).where(eq(runNodes.runId, result.runId)).get();
    expect(node?.status).toBe("failed");
    expect(node?.materials).toEqual({ source: "" });
    expect(node?.error).not.toBeNull();
  });

  it("finalizes the runs row even when execution throws mid-flight", async () => {
    // Pre-create .kiri/runs as a *file* so mkdirSync(.../runs/<id>, {recursive: true})
    // throws ENOTDIR mid-execution. Stand-in for any non-envelope throw inside
    // the try block (db failures, future node-kind dispatch errors, etc.).
    writeFileSync(join(cwd, ".kiri", "runs"), "blocker");
    const wf = makeWorkflow("throwy", ["scripts/n.sh"]);

    let caught: unknown;
    try {
      await runWorkflow(db, wf, { cwd, trigger: "manual" });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();

    const allRuns = db.select().from(runs).all();
    expect(allRuns).toHaveLength(1);
    expect(allRuns[0].status).toBe("failed");
    expect(allRuns[0].finishedAt).toBeInstanceOf(Date);
    expect(allRuns[0].error).not.toBeNull();
  });

  it("exposes KIRI_RUN_ID and KIRI_NODE_INDEX in the script's env", async () => {
    writeScript("scripts/dump.sh", '#!/bin/sh\necho "RUN=$KIRI_RUN_ID NODE=$KIRI_NODE_INDEX"\n');
    const wf = makeWorkflow("env-vars", ["scripts/dump.sh"]);

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });

    const node = db.select().from(runNodes).where(eq(runNodes.runId, result.runId)).get();
    expect(node?.output).toBe(`RUN=${result.runId} NODE=0\n`);
  });

  it("forwards USER and LOGNAME so user-session auth (keychain, ssh-agent) works", async () => {
    writeScript("scripts/who.sh", '#!/bin/sh\necho "USER=$USER LOGNAME=$LOGNAME"\n');
    const wf = makeWorkflow("who", ["scripts/who.sh"]);

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });

    const node = db.select().from(runNodes).where(eq(runNodes.runId, result.runId)).get();
    expect(node?.output).toBe(
      `USER=${process.env.USER ?? ""} LOGNAME=${process.env.LOGNAME ?? ""}\n`,
    );
  });
});
