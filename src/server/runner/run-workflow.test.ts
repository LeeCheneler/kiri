import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asc, eq } from "drizzle-orm";
import { bootstrap } from "../bootstrap.ts";
import type { KiriDb } from "../db/index.ts";
import { runSteps, runs } from "../db/schema.ts";
import { type KiriEvent, createEventBus } from "../events/index.ts";
import type { WorkflowDefinition, WorkflowStep } from "../workflows/index.ts";
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

  const writeBundle = (name: string, body: string, sidecars: Record<string, string> = {}) => {
    const bundleDir = join(cwd, "scripts", name);
    mkdirSync(bundleDir, { recursive: true });
    const runPath = join(bundleDir, "run.sh");
    writeFileSync(runPath, body);
    chmodSync(runPath, 0o755);
    for (const [filename, contents] of Object.entries(sidecars)) {
      writeFileSync(join(bundleDir, filename), contents);
    }
    return runPath;
  };

  const useSteps = (...names: string[]): WorkflowStep[] => names.map((name) => ({ use: name }));

  const makeWorkflow = (name: string, steps: WorkflowStep[]): WorkflowDefinition => ({
    name,
    steps,
  });

  it("persists a single use: step run + envelope and reports ok", async () => {
    writeBundle("hello", "#!/bin/sh\necho hi from kiri\n");
    const wf = makeWorkflow("greeter", useSteps("hello"));

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });

    expect(result.status).toBe("ok");

    const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
    expect(run?.workflowName).toBe("greeter");
    expect(run?.status).toBe("ok");
    expect(run?.trigger).toBe("manual");
    expect(run?.startedAt).toBeInstanceOf(Date);
    expect(run?.finishedAt).toBeInstanceOf(Date);
    expect(run?.error).toBeNull();

    const stepRows = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).all();
    expect(stepRows).toHaveLength(1);
    const step = stepRows[0];
    expect(step.index).toBe(0);
    expect(step.kind).toBe("use");
    expect(step.status).toBe("ok");
    expect(step.output).toBe("hi from kiri\n");
    expect(step.materials).toEqual({
      kind: "use",
      bundle: "hello",
      files: { "run.sh": "#!/bin/sh\necho hi from kiri\n" },
    });
    expect(step.error).toBeNull();
    expect(step.traces).toMatchObject({ stdout: "hi from kiri\n", stderr: "" });
  });

  it("persists an inline sh: step with materials = { kind: 'sh', source }", async () => {
    const wf = makeWorkflow("inline", [{ sh: "echo from-inline" }]);

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });

    expect(result.status).toBe("ok");
    const step = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).get();
    expect(step?.kind).toBe("sh");
    expect(step?.output).toBe("from-inline\n");
    expect(step?.materials).toEqual({ kind: "sh", source: "echo from-inline" });
  });

  it("captures bundle sidecar files in the use: materials snapshot", async () => {
    writeBundle("with-sidecar", '#!/bin/sh\ncat "$KIRI_BUNDLE_DIR/sidecar.txt"\n', {
      "sidecar.txt": "sidecar-payload\n",
    });
    const wf = makeWorkflow("sidecar", useSteps("with-sidecar"));

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });

    expect(result.status).toBe("ok");
    const step = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).get();
    // Sidecar reachable at runtime via KIRI_BUNDLE_DIR (cwd is the per-run scratch dir).
    expect(step?.output).toBe("sidecar-payload\n");
    expect(step?.materials).toEqual({
      kind: "use",
      bundle: "with-sidecar",
      files: {
        "run.sh": '#!/bin/sh\ncat "$KIRI_BUNDLE_DIR/sidecar.txt"\n',
        "sidecar.txt": "sidecar-payload\n",
      },
    });
  });

  it("skips sub-directories inside a bundle when snapshotting materials", async () => {
    writeBundle("with-subdir", "#!/bin/sh\necho hi\n");
    mkdirSync(join(cwd, "scripts", "with-subdir", "prompts"));
    writeFileSync(
      join(cwd, "scripts", "with-subdir", "prompts", "system.txt"),
      "ignored payload\n",
    );
    const wf = makeWorkflow("subdir", useSteps("with-subdir"));

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });

    const step = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).get();
    expect(step?.materials).toEqual({
      kind: "use",
      bundle: "with-subdir",
      files: { "run.sh": "#!/bin/sh\necho hi\n" },
    });
  });

  it("pipes step output to the next step's stdin (mixed use → sh)", async () => {
    writeBundle("emit", "#!/bin/sh\necho first-output\n");
    const wf = makeWorkflow("pipe", [{ use: "emit" }, { sh: "cat" }]);

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });

    expect(result.status).toBe("ok");
    const steps = db
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, result.runId))
      .orderBy(asc(runSteps.index))
      .all();
    expect(steps).toHaveLength(2);
    expect(steps[0].output).toBe("first-output\n");
    expect(steps[1].output).toBe("first-output\n");
  });

  it("halts on first failure and does not create rows for later steps", async () => {
    writeBundle("boom", "#!/bin/sh\necho before-fail\nexit 5\n");
    writeBundle("wont-run", "#!/bin/sh\necho should-not-run\n");
    const wf = makeWorkflow("halts", useSteps("boom", "wont-run"));

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });

    expect(result.status).toBe("failed");

    const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
    expect(run?.status).toBe("failed");
    expect(run?.error).not.toBeNull();
    expect(run?.finishedAt).toBeInstanceOf(Date);

    const steps = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).all();
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe("failed");
    expect(steps[0].error).not.toBeNull();
  });

  it("captures bundle source at run start; later edits don't change the snapshot", async () => {
    const runPath = writeBundle("v", "#!/bin/sh\necho v1\n");
    const wf = makeWorkflow("snap", useSteps("v"));

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });
    writeFileSync(runPath, "#!/bin/sh\necho v2\n");

    const step = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).get();
    expect(step?.materials).toEqual({
      kind: "use",
      bundle: "v",
      files: { "run.sh": "#!/bin/sh\necho v1\n" },
    });
  });

  it("snapshots the resolved definition onto the run row", async () => {
    writeBundle("n", "#!/bin/sh\necho hi\n");
    const wf: WorkflowDefinition = {
      name: "snapshot",
      steps: [{ use: "n", env: { FOO: "bar" } }],
      gating: "auto",
      schedule: "*/5 * * * *",
    };

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });

    const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
    expect(run?.definitionSnapshot).toEqual({
      name: "snapshot",
      steps: [{ use: "n", env: { FOO: "bar" } }],
      gating: "auto",
      schedule: "*/5 * * * *",
    });
  });

  it("removes the scratch dir after a successful run", async () => {
    writeBundle("ok", "#!/bin/sh\necho ok\n");
    const wf = makeWorkflow("clean-ok", useSteps("ok"));

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });

    expect(existsSync(join(cwd, ".kiri", "runs", result.runId))).toBe(false);
  });

  it("removes the scratch dir after a failed run", async () => {
    writeBundle("fail", "#!/bin/sh\nexit 1\n");
    const wf = makeWorkflow("clean-fail", useSteps("fail"));

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });

    expect(result.status).toBe("failed");
    expect(existsSync(join(cwd, ".kiri", "runs", result.runId))).toBe(false);
  });

  it("fails the step when the bundle directory is missing on disk", async () => {
    const wf = makeWorkflow("missing", useSteps("ghost"));

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });

    expect(result.status).toBe("failed");
    const step = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).get();
    expect(step?.status).toBe("failed");
    expect(step?.materials).toEqual({ kind: "use", bundle: "ghost", files: {} });
    expect(step?.error).not.toBeNull();
  });

  it("finalizes the runs row even when execution throws mid-flight", async () => {
    writeBundle("n", "#!/bin/sh\necho hi\n");
    // Pre-create .kiri/runs as a *file* so mkdirSync(.../runs/<id>, {recursive: true})
    // throws ENOTDIR mid-execution. Stand-in for any non-envelope throw inside
    // the try block (db failures, future step-kind dispatch errors, etc.).
    writeFileSync(join(cwd, ".kiri", "runs"), "blocker");
    const wf = makeWorkflow("throwy", useSteps("n"));

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

  it("exposes KIRI_RUN_ID, KIRI_STEP_INDEX, KIRI_REPO_ROOT, KIRI_META_FILE, and KIRI_BUNDLE_DIR for use: steps", async () => {
    writeBundle(
      "dump",
      '#!/bin/sh\necho "RUN=$KIRI_RUN_ID STEP=$KIRI_STEP_INDEX ROOT=$KIRI_REPO_ROOT META=$KIRI_META_FILE BUNDLE=$KIRI_BUNDLE_DIR"\n',
    );
    const wf = makeWorkflow("env-vars", useSteps("dump"));

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });

    const step = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).get();
    expect(step?.output).toBe(
      `RUN=${result.runId} STEP=0 ROOT=${cwd} META=${join(cwd, ".kiri", "runs", result.runId, "step-0.meta.json")} BUNDLE=${join(cwd, "scripts", "dump")}\n`,
    );
  });

  it("does not set KIRI_BUNDLE_DIR for sh: steps (no bundle to point at)", async () => {
    const wf: WorkflowDefinition = {
      name: "no-bundle",
      steps: [{ sh: 'echo "BUNDLE=${KIRI_BUNDLE_DIR-unset}"' }],
    };

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });

    const step = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).get();
    expect(step?.output).toBe("BUNDLE=unset\n");
  });

  it("kiri-injected vars overwrite user env keys on collision (PATH cannot be hijacked)", async () => {
    // The schema rejects KIRI_*; PATH is the cleanest user-controllable
    // collision target since it is also overlaid by the runner.
    writeBundle("path", '#!/bin/sh\necho "PATH=$PATH"\n');
    const wf: WorkflowDefinition = {
      name: "collision",
      steps: [{ use: "path", env: { PATH: "/sneaky/bin" } }],
    };

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });

    const step = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).get();
    expect(step?.output).toBe(`PATH=${process.env.PATH ?? ""}\n`);
  });

  it("forwards user env values for non-conflicting keys to the bundle", async () => {
    writeBundle("greet", '#!/bin/sh\necho "name=$NAME"\n');
    const wf: WorkflowDefinition = {
      name: "with-env",
      steps: [{ use: "greet", env: { NAME: "lee" } }],
    };

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });

    const step = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).get();
    expect(step?.output).toBe("name=lee\n");
  });

  it("forwards USER and LOGNAME so user-session auth (keychain, ssh-agent) works", async () => {
    writeBundle("who", '#!/bin/sh\necho "USER=$USER LOGNAME=$LOGNAME"\n');
    const wf = makeWorkflow("who", useSteps("who"));

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });

    const step = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).get();
    expect(step?.output).toBe(
      `USER=${process.env.USER ?? ""} LOGNAME=${process.env.LOGNAME ?? ""}\n`,
    );
  });

  it("publishes the run lifecycle event sequence for an ok run", async () => {
    writeBundle("a", "#!/bin/sh\necho a\n");
    writeBundle("b", "#!/bin/sh\necho b\n");
    const wf = makeWorkflow("seq-ok", useSteps("a", "b"));
    const bus = createEventBus();
    const seen: KiriEvent[] = [];
    bus.subscribe((e) => seen.push(e));

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual", bus });

    expect(result.status).toBe("ok");
    expect(seen).toEqual([
      { type: "run.started", id: result.runId },
      { type: "run.step.updated", runId: result.runId, step: 0, status: "running" },
      { type: "run.step.updated", runId: result.runId, step: 0, status: "ok" },
      { type: "run.step.updated", runId: result.runId, step: 1, status: "running" },
      { type: "run.step.updated", runId: result.runId, step: 1, status: "ok" },
      { type: "run.updated", id: result.runId, status: "ok" },
      { type: "run.finished", id: result.runId, status: "ok", workflowName: "seq-ok" },
    ]);
  });

  it("publishes a failed step event and stops emitting later steps when a run fails", async () => {
    writeBundle("ok-step", "#!/bin/sh\necho ok\n");
    writeBundle("bad-step", "#!/bin/sh\nexit 1\n");
    writeBundle("never", "#!/bin/sh\necho never\n");
    const wf = makeWorkflow("seq-fail", useSteps("ok-step", "bad-step", "never"));
    const bus = createEventBus();
    const seen: KiriEvent[] = [];
    bus.subscribe((e) => seen.push(e));

    const result = await runWorkflow(db, wf, { cwd, trigger: "manual", bus });

    expect(result.status).toBe("failed");
    expect(seen).toEqual([
      { type: "run.started", id: result.runId },
      { type: "run.step.updated", runId: result.runId, step: 0, status: "running" },
      { type: "run.step.updated", runId: result.runId, step: 0, status: "ok" },
      { type: "run.step.updated", runId: result.runId, step: 1, status: "running" },
      { type: "run.step.updated", runId: result.runId, step: 1, status: "failed" },
      { type: "run.updated", id: result.runId, status: "failed" },
      { type: "run.finished", id: result.runId, status: "failed", workflowName: "seq-fail" },
    ]);
  });

  it("publishes run.updated/run.finished even when execution throws mid-flight", async () => {
    writeBundle("n", "#!/bin/sh\necho hi\n");
    writeFileSync(join(cwd, ".kiri", "runs"), "blocker");
    const wf = makeWorkflow("throwy-bus", useSteps("n"));
    const bus = createEventBus();
    const seen: KiriEvent[] = [];
    bus.subscribe((e) => seen.push(e));

    let caught: unknown;
    try {
      await runWorkflow(db, wf, { cwd, trigger: "manual", bus });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    const runRow = db.select().from(runs).get();
    const runId = runRow?.id;
    expect(runId).toBeDefined();
    // The throw happens before any step row is inserted (mkdirSync of the
    // scratch dir fails first), so no step events fire — but run.started,
    // run.updated, and run.finished still bracket the lifecycle.
    expect(seen).toEqual([
      { type: "run.started", id: runId as string },
      { type: "run.updated", id: runId as string, status: "failed" },
      {
        type: "run.finished",
        id: runId as string,
        status: "failed",
        workflowName: "throwy-bus",
      },
    ]);
  });
});
