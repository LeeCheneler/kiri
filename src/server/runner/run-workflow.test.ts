import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asc, eq } from "drizzle-orm";
import { bootstrap } from "../bootstrap.ts";
import type { KiriDb } from "../db/index.ts";
import { articles, recommendations, runSteps, runs } from "../db/schema.ts";
import { type KiriEvent, createEventBus } from "../events/index.ts";
import type { WorkflowDefinition, WorkflowStep } from "../workflows/index.ts";
import { createCancelRegistry } from "./cancel-registry.ts";
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

    const result = await runWorkflow(db, wf, { cwd }).done;

    expect(result.status).toBe("ok");

    const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
    expect(run?.workflowName).toBe("greeter");
    expect(run?.status).toBe("ok");
    expect(run?.startedAt).toBeInstanceOf(Date);
    expect(run?.finishedAt).toBeInstanceOf(Date);
    expect(run?.error).toBeNull();

    const stepRows = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).all();
    expect(stepRows).toHaveLength(1);
    const step = stepRows[0];
    expect(step.index).toBe(0);
    expect(step.kind).toBe("use");
    expect(step.status).toBe("ok");
    expect(step.startedAt).toBeInstanceOf(Date);
    expect(step.finishedAt).toBeInstanceOf(Date);
    expect(step.output).toBe("hi from kiri\n");
    expect(step.error).toBeNull();
    expect(step.traces).toMatchObject({ stdout: "hi from kiri\n", stderr: "" });
  });

  it("persists an inline sh: step", async () => {
    const wf = makeWorkflow("inline", [{ sh: "echo from-inline" }]);

    const result = await runWorkflow(db, wf, { cwd }).done;

    expect(result.status).toBe("ok");
    const step = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).get();
    expect(step?.kind).toBe("sh");
    expect(step?.output).toBe("from-inline\n");
  });

  it("pipes step output to the next step's stdin (mixed use → sh)", async () => {
    writeBundle("emit", "#!/bin/sh\necho first-output\n");
    const wf = makeWorkflow("pipe", [{ use: "emit" }, { sh: "cat" }]);

    const result = await runWorkflow(db, wf, { cwd }).done;

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

    const result = await runWorkflow(db, wf, { cwd }).done;

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

  describe("git ref", () => {
    const git = (at: string, ...args: string[]) => {
      const r = spawnSync("git", args, { cwd: at, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    };

    it("leaves gitSha/gitDirty null when the data dir is not a git repo", async () => {
      writeBundle("n", "#!/bin/sh\necho hi\n");
      const wf = makeWorkflow("no-git", useSteps("n"));

      const result = await runWorkflow(db, wf, { cwd }).done;

      const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
      expect(run?.gitSha).toBeNull();
      expect(run?.gitDirty).toBeNull();
    });

    it("captures HEAD sha with dirty=false when the data dir is a clean repo", async () => {
      writeBundle("n", "#!/bin/sh\necho hi\n");
      git(cwd, "init", "-q");
      git(cwd, "config", "user.email", "test@example.com");
      git(cwd, "config", "user.name", "Test");
      git(cwd, "add", ".");
      git(cwd, "commit", "-q", "-m", "init");
      const wf = makeWorkflow("clean", useSteps("n"));

      const result = await runWorkflow(db, wf, { cwd }).done;

      const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
      expect(run?.gitSha).toMatch(/^[0-9a-f]{40}$/);
      // The runner writes .kiri/runs/<id>/... mid-run; by the time we read
      // the row that scratch dir is cleaned up so the tree is clean again.
      expect(run?.gitDirty).toBe(false);
    });

    it("captures dirty=true when the working tree has uncommitted changes", async () => {
      writeBundle("n", "#!/bin/sh\necho hi\n");
      git(cwd, "init", "-q");
      git(cwd, "config", "user.email", "test@example.com");
      git(cwd, "config", "user.name", "Test");
      git(cwd, "add", ".");
      git(cwd, "commit", "-q", "-m", "init");
      writeFileSync(join(cwd, "uncommitted.txt"), "hello");
      const wf = makeWorkflow("dirty", useSteps("n"));

      const result = await runWorkflow(db, wf, { cwd }).done;

      const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
      expect(run?.gitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(run?.gitDirty).toBe(true);
    });
  });

  it("snapshots the resolved definition onto the run row", async () => {
    writeBundle("n", "#!/bin/sh\necho hi\n");
    const wf: WorkflowDefinition = {
      name: "snapshot",
      steps: [{ use: "n", env: { FOO: "bar" } }],
    };

    const result = await runWorkflow(db, wf, { cwd }).done;

    const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
    expect(run?.definitionSnapshot).toEqual({
      name: "snapshot",
      steps: [{ use: "n", env: { FOO: "bar" } }],
    });
  });

  it("removes the scratch dir after a successful run", async () => {
    writeBundle("ok", "#!/bin/sh\necho ok\n");
    const wf = makeWorkflow("clean-ok", useSteps("ok"));

    const result = await runWorkflow(db, wf, { cwd }).done;

    expect(existsSync(join(cwd, ".kiri", "runs", result.runId))).toBe(false);
  });

  it("removes the scratch dir after a failed run", async () => {
    writeBundle("fail", "#!/bin/sh\nexit 1\n");
    const wf = makeWorkflow("clean-fail", useSteps("fail"));

    const result = await runWorkflow(db, wf, { cwd }).done;

    expect(result.status).toBe("failed");
    expect(existsSync(join(cwd, ".kiri", "runs", result.runId))).toBe(false);
  });

  it("fails the step when the bundle directory is missing on disk", async () => {
    const wf = makeWorkflow("missing", useSteps("ghost"));

    const result = await runWorkflow(db, wf, { cwd }).done;

    expect(result.status).toBe("failed");
    const step = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).get();
    expect(step?.status).toBe("failed");
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
      await runWorkflow(db, wf, { cwd }).done;
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

  it("exposes KIRI_RUN_ID, KIRI_STEP_INDEX, KIRI_REPO_ROOT, and KIRI_BUNDLE_DIR for use: steps", async () => {
    writeBundle(
      "dump",
      '#!/bin/sh\necho "RUN=$KIRI_RUN_ID STEP=$KIRI_STEP_INDEX ROOT=$KIRI_REPO_ROOT BUNDLE=$KIRI_BUNDLE_DIR"\n',
    );
    const wf = makeWorkflow("env-vars", useSteps("dump"));

    const result = await runWorkflow(db, wf, { cwd }).done;

    const step = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).get();
    expect(step?.output).toBe(
      `RUN=${result.runId} STEP=0 ROOT=${cwd} BUNDLE=${join(cwd, "scripts", "dump")}\n`,
    );
  });

  it("does not set KIRI_BUNDLE_DIR for sh: steps (no bundle to point at)", async () => {
    const wf: WorkflowDefinition = {
      name: "no-bundle",
      steps: [{ sh: 'echo "BUNDLE=${KIRI_BUNDLE_DIR-unset}"' }],
    };

    const result = await runWorkflow(db, wf, { cwd }).done;

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

    const result = await runWorkflow(db, wf, { cwd }).done;

    const step = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).get();
    expect(step?.output).toBe(`PATH=${process.env.PATH ?? ""}\n`);
  });

  it("forwards user env values for non-conflicting keys to the bundle", async () => {
    writeBundle("greet", '#!/bin/sh\necho "name=$NAME"\n');
    const wf: WorkflowDefinition = {
      name: "with-env",
      steps: [{ use: "greet", env: { NAME: "lee" } }],
    };

    const result = await runWorkflow(db, wf, { cwd }).done;

    const step = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).get();
    expect(step?.output).toBe("name=lee\n");
  });

  it("forwards USER and LOGNAME so user-session auth (keychain, ssh-agent) works", async () => {
    writeBundle("who", '#!/bin/sh\necho "USER=$USER LOGNAME=$LOGNAME"\n');
    const wf = makeWorkflow("who", useSteps("who"));

    const result = await runWorkflow(db, wf, { cwd }).done;

    const step = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).get();
    expect(step?.output).toBe(
      `USER=${process.env.USER ?? ""} LOGNAME=${process.env.LOGNAME ?? ""}\n`,
    );
  });

  it("fails the run when a step env value references an input absent from the run snapshot", async () => {
    writeBundle("hello", "#!/bin/sh\necho hi\n");
    const wf: WorkflowDefinition = {
      name: "needs-input",
      inputs: [{ name: "pr_number" }],
      steps: [{ use: "hello", env: { PR: { input: "pr_number" } } }],
    };

    // No supplied value, no default — the snapshot omits the input, so
    // step env build can't resolve the ref. The invoke API enforces
    // required-but-missing earlier; reaching the runner is an invariant
    // violation we still surface clearly.
    const { runId, done } = runWorkflow(db, wf, { cwd });
    const thrown = await done.catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(
      /env "PR" references input "pr_number", which is not present on the run snapshot/,
    );

    const run = db.select().from(runs).where(eq(runs.id, runId)).get();
    expect(run?.status).toBe("failed");
    expect(run?.error).toEqual(
      expect.objectContaining({
        message: expect.stringContaining(
          'references input "pr_number", which is not present on the run snapshot',
        ),
      }),
    );
  });

  it("publishes the run lifecycle event sequence for an ok run", async () => {
    writeBundle("a", "#!/bin/sh\necho a\n");
    writeBundle("b", "#!/bin/sh\necho b\n");
    const wf = makeWorkflow("seq-ok", useSteps("a", "b"));
    const bus = createEventBus();
    const seen: KiriEvent[] = [];
    bus.subscribe((e) => seen.push(e));

    const result = await runWorkflow(db, wf, { cwd, bus }).done;

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

    const result = await runWorkflow(db, wf, { cwd, bus }).done;

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
      await runWorkflow(db, wf, { cwd, bus }).done;
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

  describe("cancel handling", () => {
    it("cancels a running step: run + step transition to cancelled, child is killed", async () => {
      const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 100 });
      // `exec 1>&- 2>&-` closes sh's stdout/stderr before sleep is forked, so
      // Bun's pipe readers get EOF immediately. Without this, an orphaned
      // sleep inherits the write ends and hangs the readers until natural
      // completion (only matters on Linux/CI; macOS resolves them sooner).
      const wf: WorkflowDefinition = {
        name: "long",
        steps: [{ sh: "exec 1>&- 2>&-; sleep 5" }],
      };
      const bus = createEventBus();
      const seen: KiriEvent[] = [];
      bus.subscribe((e) => seen.push(e));

      const startedAt = Date.now();
      const { runId, done } = runWorkflow(db, wf, {
        cwd,
        bus,
        cancelRegistry,
      });

      // Brief settle so the spawn's child is actually live before we signal it.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(cancelRegistry.requestCancel(runId)).toBe(true);

      const result = await done;
      expect(Date.now() - startedAt).toBeLessThan(2000);
      expect(result.status).toBe("cancelled");

      const run = db.select().from(runs).where(eq(runs.id, runId)).get();
      expect(run?.status).toBe("cancelled");
      expect(run?.error).toEqual({ message: "run cancelled" });
      expect(run?.finishedAt).toBeInstanceOf(Date);

      const step = db.select().from(runSteps).where(eq(runSteps.runId, runId)).get();
      expect(step?.status).toBe("cancelled");
      expect(step?.error).toEqual({ message: "run cancelled" });

      expect(seen).toContainEqual({
        type: "run.step.updated",
        runId,
        step: 0,
        status: "cancelled",
      });
      expect(seen).toContainEqual({ type: "run.updated", id: runId, status: "cancelled" });
      expect(seen).toContainEqual({
        type: "run.finished",
        id: runId,
        status: "cancelled",
        workflowName: "long",
      });
    });

    it("escalates to SIGKILL when the child traps and ignores SIGTERM", async () => {
      const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 150 });
      // `trap '' TERM` makes sh ignore SIGTERM. The busy `while :; do :; done`
      // loop is a shell builtin (no fork), so killing sh closes the pipes —
      // a forked `sleep` would orphan and hold stdout open, hanging the reader.
      const wf: WorkflowDefinition = {
        name: "untrappable",
        steps: [{ sh: "trap '' TERM; while :; do :; done" }],
      };

      const startedAt = Date.now();
      const { runId, done } = runWorkflow(db, wf, { cwd, cancelRegistry });

      await new Promise((resolve) => setTimeout(resolve, 50));
      cancelRegistry.requestCancel(runId);

      const result = await done;
      const elapsed = Date.now() - startedAt;

      expect(result.status).toBe("cancelled");
      // Took at least the grace period because SIGTERM was ignored.
      expect(elapsed).toBeGreaterThanOrEqual(150);
      expect(elapsed).toBeLessThan(2000);
    });

    it("inter-step cancel halts before the next step starts; earlier ok step stays ok", async () => {
      writeBundle("first", "#!/bin/sh\necho first\n");
      writeBundle("second", "#!/bin/sh\necho second\n");
      const wf = makeWorkflow("two-step", useSteps("first", "second"));
      const cancelRegistry = createCancelRegistry();
      const bus = createEventBus();

      // Cancel synchronously when step 0's `ok` event lands. The runner's
      // `isCancelled` check at the top of iteration 1 picks it up and breaks.
      let target = "";
      bus.subscribe((e) => {
        if (
          e.type === "run.step.updated" &&
          e.runId === target &&
          e.step === 0 &&
          e.status === "ok"
        ) {
          cancelRegistry.requestCancel(target);
        }
      });

      const { runId, done } = runWorkflow(db, wf, {
        cwd,
        bus,
        cancelRegistry,
      });
      target = runId;

      const result = await done;

      expect(result.status).toBe("cancelled");

      const stepRows = db.select().from(runSteps).where(eq(runSteps.runId, runId)).all();
      // Only step 0 was inserted. The post-loop `cancelled` check flips the
      // run row but leaves step 0's terminal `ok` intact.
      expect(stepRows).toHaveLength(1);
      expect(stepRows[0].status).toBe("ok");

      const run = db.select().from(runs).where(eq(runs.id, runId)).get();
      expect(run?.status).toBe("cancelled");
      expect(run?.error).toEqual({ message: "run cancelled" });
    });

    it("releases the registry entry on terminal transition", async () => {
      writeBundle("ok", "#!/bin/sh\necho ok\n");
      const wf = makeWorkflow("ok-run", useSteps("ok"));
      const cancelRegistry = createCancelRegistry();

      const result = await runWorkflow(db, wf, { cwd, cancelRegistry }).done;
      expect(result.status).toBe("ok");

      // requestCancel returns false because release() deleted the entry.
      expect(cancelRegistry.requestCancel(result.runId)).toBe(false);
    });

    it("propagates cancel arriving during the summariser to the run status", async () => {
      writeBundle("quick", "#!/bin/sh\necho done\n");
      writeBundle("slow-summer", "#!/bin/sh\nexec 1>&- 2>&-; sleep 5\n");
      const wf: WorkflowDefinition = {
        name: "summed-cancel",
        steps: [{ use: "quick" }],
        summarize: { use: "slow-summer" },
      };
      const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 100 });
      const bus = createEventBus();

      // Cancel as soon as the summariser starts running.
      let target = "";
      bus.subscribe((e) => {
        if (
          e.type === "run.step.updated" &&
          e.runId === target &&
          e.step === 1 &&
          e.status === "running"
        ) {
          cancelRegistry.requestCancel(target);
        }
      });

      const { runId, done } = runWorkflow(db, wf, {
        cwd,
        bus,
        cancelRegistry,
      });
      target = runId;

      const result = await done;
      expect(result.status).toBe("cancelled");

      const run = db.select().from(runs).where(eq(runs.id, runId)).get();
      expect(run?.status).toBe("cancelled");
      expect(run?.summary).toBeNull();
      expect(run?.error).toEqual({ message: "run cancelled" });

      const summaryStep = db
        .select()
        .from(runSteps)
        .where(eq(runSteps.runId, runId))
        .orderBy(asc(runSteps.index))
        .all()
        .find((s) => s.isSummary);
      expect(summaryStep?.status).toBe("cancelled");
    });

    it("forwards the spawned child to the cancel registry via setChild", async () => {
      writeBundle("ok", "#!/bin/sh\necho ok\n");
      const wf = makeWorkflow("ok-run", useSteps("ok"));
      const cancelRegistry = createCancelRegistry();
      const setChildCalls: string[] = [];
      const wrapped = {
        ...cancelRegistry,
        setChild(runId: string, child: { kill(signal?: NodeJS.Signals | number): void }) {
          setChildCalls.push(runId);
          cancelRegistry.setChild(runId, child);
        },
      };

      const result = await runWorkflow(db, wf, {
        cwd,
        cancelRegistry: wrapped,
      }).done;

      expect(result.status).toBe("ok");
      expect(setChildCalls).toEqual([result.runId]);
    });
  });

  describe("summarize", () => {
    it("writes the summariser's trimmed stdout to runs.summary on success", async () => {
      writeBundle("step", "#!/bin/sh\necho one\n");
      writeBundle("summer", "#!/bin/sh\necho '  workflow ran one step.  '\n");
      const wf: WorkflowDefinition = {
        name: "summed",
        steps: [{ use: "step" }],
        summarize: { use: "summer" },
      };

      const result = await runWorkflow(db, wf, { cwd }).done;
      expect(result.status).toBe("ok");

      const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
      expect(run?.summary).toBe("workflow ran one step.");
    });

    it("records the summariser as a run_steps row with isSummary=true", async () => {
      writeBundle("step", "#!/bin/sh\necho one\n");
      writeBundle("summer", "#!/bin/sh\necho summary\n");
      const wf: WorkflowDefinition = {
        name: "summed",
        steps: [{ use: "step" }],
        summarize: { use: "summer" },
      };

      const result = await runWorkflow(db, wf, { cwd }).done;
      const stepsRows = db
        .select()
        .from(runSteps)
        .where(eq(runSteps.runId, result.runId))
        .orderBy(asc(runSteps.index))
        .all();

      expect(stepsRows).toHaveLength(2);
      expect(stepsRows[0].isSummary).toBe(false);
      expect(stepsRows[1].isSummary).toBe(true);
      expect(stepsRows[1].kind).toBe("use");
    });

    it("works with an inline sh: summarize step", async () => {
      writeBundle("step", "#!/bin/sh\necho one\n");
      const wf: WorkflowDefinition = {
        name: "summed-sh",
        steps: [{ use: "step" }],
        summarize: { sh: "echo inline-summary" },
      };

      const result = await runWorkflow(db, wf, { cwd }).done;
      expect(result.status).toBe("ok");

      const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
      expect(run?.summary).toBe("inline-summary");

      const summaryStep = db
        .select()
        .from(runSteps)
        .where(eq(runSteps.runId, result.runId))
        .orderBy(asc(runSteps.index))
        .all()
        .find((s) => s.isSummary);
      expect(summaryStep?.kind).toBe("sh");
    });

    it("leaves runs.status unchanged when the summariser fails", async () => {
      writeBundle("step", "#!/bin/sh\necho one\n");
      writeBundle("bad-summer", "#!/bin/sh\necho oops >&2\nexit 7\n");
      const wf: WorkflowDefinition = {
        name: "summer-fails",
        steps: [{ use: "step" }],
        summarize: { use: "bad-summer" },
      };

      const result = await runWorkflow(db, wf, { cwd }).done;
      expect(result.status).toBe("ok");

      const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
      expect(run?.status).toBe("ok");
      expect(run?.summary).toBeNull();
      expect(run?.error).toBeNull();

      const summaryStep = db
        .select()
        .from(runSteps)
        .where(eq(runSteps.runId, result.runId))
        .orderBy(asc(runSteps.index))
        .all()
        .find((s) => s.isSummary);
      expect(summaryStep?.status).toBe("failed");
      expect(summaryStep?.error).not.toBeNull();
    });

    it("skips the summariser when the run failed", async () => {
      writeBundle("boom", "#!/bin/sh\nexit 3\n");
      writeBundle(
        "summer-marker",
        '#!/bin/sh\necho summer-ran > "$KIRI_REPO_ROOT/summer-marker"\necho summary\n',
      );
      const wf: WorkflowDefinition = {
        name: "failed-summed",
        steps: [{ use: "boom" }],
        summarize: { use: "summer-marker" },
      };

      const result = await runWorkflow(db, wf, { cwd }).done;
      expect(result.status).toBe("failed");

      // No summariser row inserted; the marker file was never created.
      expect(existsSync(join(cwd, "summer-marker"))).toBe(false);
      const stepsRows = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).all();
      expect(stepsRows.some((s) => s.isSummary)).toBe(false);

      const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
      expect(run?.summary).toBeNull();
    });

    it("skips the summariser when a publish failed", async () => {
      writeBundle("step", "#!/bin/sh\necho one\n");
      writeBundle("bad-pub", "#!/bin/sh\nexit 2\n");
      writeBundle(
        "summer-marker",
        '#!/bin/sh\necho summer-ran > "$KIRI_REPO_ROOT/summer-marker"\necho summary\n',
      );
      const wf: WorkflowDefinition = {
        name: "pub-fail-skips-summer",
        steps: [{ use: "step" }],
        publish: [{ name: "bad", use: "bad-pub" }],
        summarize: { use: "summer-marker" },
      };

      const result = await runWorkflow(db, wf, { cwd }).done;
      expect(result.status).toBe("failed");

      expect(existsSync(join(cwd, "summer-marker"))).toBe(false);
      const stepsRows = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).all();
      expect(stepsRows.some((s) => s.isSummary)).toBe(false);

      const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
      expect(run?.summary).toBeNull();
    });

    it("treats empty summariser output as null (not an empty string)", async () => {
      writeBundle("step", "#!/bin/sh\necho one\n");
      writeBundle("blank", "#!/bin/sh\necho '   '\n");
      const wf: WorkflowDefinition = {
        name: "blank-sum",
        steps: [{ use: "step" }],
        summarize: { use: "blank" },
      };

      const result = await runWorkflow(db, wf, { cwd }).done;
      const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
      expect(run?.summary).toBeNull();
    });

    it("skips the summariser entirely when the run is cancelled", async () => {
      const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 100 });
      writeBundle(
        "summer-marker",
        '#!/bin/sh\necho summer-ran > "$KIRI_REPO_ROOT/summer-marker"\necho summary\n',
      );
      const wf: WorkflowDefinition = {
        name: "cancel-skip-sum",
        steps: [{ sh: "exec 1>&- 2>&-; sleep 5" }],
        summarize: { use: "summer-marker" },
      };

      const { runId, done } = runWorkflow(db, wf, {
        cwd,
        cancelRegistry,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      cancelRegistry.requestCancel(runId);

      const result = await done;
      expect(result.status).toBe("cancelled");

      // No summariser row was inserted; the marker file does not exist.
      expect(existsSync(join(cwd, "summer-marker"))).toBe(false);
      const stepsRows = db.select().from(runSteps).where(eq(runSteps.runId, runId)).all();
      expect(stepsRows.some((s) => s.isSummary)).toBe(false);

      const run = db.select().from(runs).where(eq(runs.id, runId)).get();
      expect(run?.summary).toBeNull();
    });

    it("exposes KIRI_RUN_CONTEXT_FILE pointing at the run envelope JSON", async () => {
      writeBundle("step", "#!/bin/sh\necho hello\n");
      writeBundle("context-dump", '#!/bin/sh\ncat "$KIRI_RUN_CONTEXT_FILE"\n');
      const wf: WorkflowDefinition = {
        name: "ctx",
        steps: [{ use: "step" }],
        summarize: { use: "context-dump" },
      };

      const result = await runWorkflow(db, wf, { cwd }).done;
      const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
      const summary = run?.summary;
      expect(summary).toBeDefined();
      // Summariser stdout was a JSON blob piped through `cat`.
      const parsed = JSON.parse(summary as string);
      expect(parsed.workflow).toBe("ctx");
      expect(parsed.status).toBe("ok");
      expect(typeof parsed.startedAt).toBe("string");
      expect(typeof parsed.durationMs).toBe("number");
      expect(parsed.steps).toEqual([
        expect.objectContaining({
          index: 0,
          kind: "use",
          use: "step",
          status: "ok",
          stdout: "hello\n",
          stderr: "",
          error: null,
        }),
      ]);
      // Stable shape: the field is always present, empty when no publishes ran.
      expect(parsed.articles).toEqual([]);
    });

    it("includes successful articles in the summariser run-context envelope", async () => {
      writeBundle("step", "#!/bin/sh\necho one\n");
      writeBundle("art", "#!/bin/sh\necho article-body\n");
      writeBundle("context-dump", '#!/bin/sh\ncat "$KIRI_RUN_CONTEXT_FILE"\n');
      const wf: WorkflowDefinition = {
        name: "summer-sees-art",
        steps: [{ use: "step" }],
        publish: [{ name: "art", title: "Article", use: "art" }],
        summarize: { use: "context-dump" },
      };

      const result = await runWorkflow(db, wf, { cwd }).done;
      expect(result.status).toBe("ok");

      const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
      const parsed = JSON.parse(run?.summary as string);
      expect(parsed.articles).toEqual([
        { name: "art", title: "Article", content_md: "article-body" },
      ]);
    });

    it("publishes summariser step events between run.step.updated and run.updated", async () => {
      writeBundle("step", "#!/bin/sh\necho one\n");
      writeBundle("summer", "#!/bin/sh\necho summary\n");
      const wf: WorkflowDefinition = {
        name: "events",
        steps: [{ use: "step" }],
        summarize: { use: "summer" },
      };
      const bus = createEventBus();
      const seen: KiriEvent[] = [];
      bus.subscribe((e) => seen.push(e));

      const result = await runWorkflow(db, wf, { cwd, bus }).done;
      expect(result.status).toBe("ok");
      expect(seen).toEqual([
        { type: "run.started", id: result.runId },
        { type: "run.step.updated", runId: result.runId, step: 0, status: "running" },
        { type: "run.step.updated", runId: result.runId, step: 0, status: "ok" },
        { type: "run.step.updated", runId: result.runId, step: 1, status: "running" },
        { type: "run.step.updated", runId: result.runId, step: 1, status: "ok" },
        { type: "run.updated", id: result.runId, status: "ok" },
        { type: "run.finished", id: result.runId, status: "ok", workflowName: "events" },
      ]);
    });

    it("snapshots summarize onto definitionSnapshot", async () => {
      writeBundle("step", "#!/bin/sh\necho one\n");
      writeBundle("summer", "#!/bin/sh\necho summary\n");
      const wf: WorkflowDefinition = {
        name: "snap-sum",
        steps: [{ use: "step" }],
        summarize: { use: "summer", env: { KEEP: "yes" } },
      };

      const result = await runWorkflow(db, wf, { cwd }).done;
      const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
      expect(run?.definitionSnapshot).toMatchObject({
        name: "snap-sum",
        summarize: { use: "summer", env: { KEEP: "yes" } },
      });
    });

    it("does not record a summariser row for workflows without summarize", async () => {
      writeBundle("step", "#!/bin/sh\necho one\n");
      const wf = makeWorkflow("plain", useSteps("step"));

      const result = await runWorkflow(db, wf, { cwd }).done;
      const stepsRows = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).all();
      expect(stepsRows).toHaveLength(1);
      expect(stepsRows[0].isSummary).toBe(false);

      const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
      expect(run?.summary).toBeNull();
    });
  });

  describe("publish", () => {
    it("records each publish entry as a run_steps row with isPublish=true", async () => {
      writeBundle("step", "#!/bin/sh\necho one\n");
      writeBundle("digest", "#!/bin/sh\necho digest-body\n");
      writeBundle("notes", "#!/bin/sh\necho notes-body\n");
      const wf: WorkflowDefinition = {
        name: "with-publish",
        steps: [{ use: "step" }],
        publish: [
          { name: "digest", use: "digest" },
          { name: "notes", sh: 'echo "from-sh"' },
        ],
      };

      const result = await runWorkflow(db, wf, { cwd }).done;
      expect(result.status).toBe("ok");

      const stepsRows = db
        .select()
        .from(runSteps)
        .where(eq(runSteps.runId, result.runId))
        .orderBy(asc(runSteps.index))
        .all();
      expect(stepsRows).toHaveLength(3);
      expect(stepsRows[0].isPublish).toBe(false);
      expect(stepsRows[0].isSummary).toBe(false);
      expect(stepsRows[1].index).toBe(1);
      expect(stepsRows[1].isPublish).toBe(true);
      expect(stepsRows[1].isSummary).toBe(false);
      expect(stepsRows[1].kind).toBe("use");
      expect(stepsRows[2].index).toBe(2);
      expect(stepsRows[2].isPublish).toBe(true);
      expect(stepsRows[2].kind).toBe("sh");
    });

    it("places publish rows between steps and summarise in the index sequence", async () => {
      writeBundle("step", "#!/bin/sh\necho one\n");
      writeBundle("art", "#!/bin/sh\necho article\n");
      writeBundle("summer", "#!/bin/sh\necho summary\n");
      const wf: WorkflowDefinition = {
        name: "full",
        steps: [{ use: "step" }],
        publish: [{ name: "art", use: "art" }],
        summarize: { use: "summer" },
      };

      const result = await runWorkflow(db, wf, { cwd }).done;
      expect(result.status).toBe("ok");

      const stepsRows = db
        .select()
        .from(runSteps)
        .where(eq(runSteps.runId, result.runId))
        .orderBy(asc(runSteps.index))
        .all();
      expect(stepsRows.map((s) => [s.index, s.isPublish, s.isSummary])).toEqual([
        [0, false, false],
        [1, true, false],
        [2, false, true],
      ]);
    });

    it("snapshots publish onto definitionSnapshot", async () => {
      writeBundle("step", "#!/bin/sh\necho one\n");
      writeBundle("art", "#!/bin/sh\necho article\n");
      const wf: WorkflowDefinition = {
        name: "snap-pub",
        steps: [{ use: "step" }],
        publish: [{ name: "art", title: "Custom Title", use: "art", env: { KEEP: "yes" } }],
      };

      const result = await runWorkflow(db, wf, { cwd }).done;

      const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
      expect(run?.definitionSnapshot).toMatchObject({
        name: "snap-pub",
        publish: [{ name: "art", title: "Custom Title", use: "art", env: { KEEP: "yes" } }],
      });
    });

    it("continues iterating siblings after a failing publish but marks the run as failed", async () => {
      writeBundle("step", "#!/bin/sh\necho one\n");
      writeBundle("bad", "#!/bin/sh\necho oops >&2\nexit 9\n");
      writeBundle("good", "#!/bin/sh\necho after-bad\n");
      const wf: WorkflowDefinition = {
        name: "pub-failure",
        steps: [{ use: "step" }],
        publish: [
          { name: "bad", use: "bad" },
          { name: "good", use: "good" },
        ],
      };

      const result = await runWorkflow(db, wf, { cwd }).done;
      expect(result.status).toBe("failed");

      const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
      expect(run?.status).toBe("failed");
      expect(run?.error).not.toBeNull();

      const publishRows = db
        .select()
        .from(runSteps)
        .where(eq(runSteps.runId, result.runId))
        .orderBy(asc(runSteps.index))
        .all()
        .filter((s) => s.isPublish);
      expect(publishRows).toHaveLength(2);
      expect(publishRows[0].status).toBe("failed");
      expect(publishRows[0].error).not.toBeNull();
      expect(publishRows[1].status).toBe("ok");

      // Only the successful sibling lands as an article row.
      const articleRows = db.select().from(articles).where(eq(articles.runId, result.runId)).all();
      expect(articleRows).toHaveLength(1);
      expect(articleRows[0].name).toBe("good");
    });

    it("persists trimmed stdout to articles with the resolved title", async () => {
      writeBundle("step", "#!/bin/sh\necho one\n");
      writeBundle("digest", "#!/bin/sh\nprintf '# Digest\\n\\nbody\\n\\n\\n'\n");
      writeBundle("notes", "#!/bin/sh\necho notes-body\n");
      const wf: WorkflowDefinition = {
        name: "pub-rows",
        steps: [{ use: "step" }],
        publish: [
          { name: "digest", title: "PR Review Digest", use: "digest" },
          { name: "release-notes", use: "notes" },
        ],
      };

      const result = await runWorkflow(db, wf, { cwd }).done;
      expect(result.status).toBe("ok");

      const articleRows = db
        .select()
        .from(articles)
        .where(eq(articles.runId, result.runId))
        .orderBy(asc(articles.name))
        .all();
      expect(articleRows).toHaveLength(2);

      const digest = articleRows.find((a) => a.name === "digest");
      expect(digest?.title).toBe("PR Review Digest");
      // Trailing whitespace stripped; interior newlines preserved.
      expect(digest?.contentMd).toBe("# Digest\n\nbody");
      expect(digest?.createdAt).toBeInstanceOf(Date);

      const notes = articleRows.find((a) => a.name === "release-notes");
      // Title defaults via resolvePublishTitle when omitted.
      expect(notes?.title).toBe("Release Notes");
      expect(notes?.contentMd).toBe("notes-body");
    });

    it("inserts an article row even when the publish writes nothing", async () => {
      writeBundle("step", "#!/bin/sh\necho one\n");
      const wf: WorkflowDefinition = {
        name: "empty-pub",
        steps: [{ use: "step" }],
        publish: [{ name: "empty", sh: "true" }],
      };

      const result = await runWorkflow(db, wf, { cwd }).done;
      expect(result.status).toBe("ok");

      const articleRows = db.select().from(articles).where(eq(articles.runId, result.runId)).all();
      expect(articleRows).toHaveLength(1);
      expect(articleRows[0].contentMd).toBe("");
      expect(articleRows[0].title).toBe("Empty");
    });

    it("does not insert an article row for a publish that fails", async () => {
      writeBundle("step", "#!/bin/sh\necho one\n");
      writeBundle("bad", "#!/bin/sh\nexit 2\n");
      const wf: WorkflowDefinition = {
        name: "no-art-on-fail",
        steps: [{ use: "step" }],
        publish: [{ name: "bad", use: "bad" }],
      };

      const result = await runWorkflow(db, wf, { cwd }).done;
      expect(result.status).toBe("failed");

      const articleRows = db.select().from(articles).where(eq(articles.runId, result.runId)).all();
      expect(articleRows).toHaveLength(0);
    });

    it("exposes earlier successful articles to later publishes via KIRI_RUN_CONTEXT_FILE", async () => {
      writeBundle("step", "#!/bin/sh\necho one\n");
      writeBundle("first-art", "#!/bin/sh\necho first-content\n");
      writeBundle("context-dump", '#!/bin/sh\ncat "$KIRI_RUN_CONTEXT_FILE"\n');
      const wf: WorkflowDefinition = {
        name: "sibling-ctx",
        steps: [{ use: "step" }],
        publish: [
          { name: "first", title: "First Article", use: "first-art" },
          { name: "second", use: "context-dump" },
        ],
      };

      const result = await runWorkflow(db, wf, { cwd }).done;
      expect(result.status).toBe("ok");

      const secondRow = db
        .select()
        .from(runSteps)
        .where(eq(runSteps.runId, result.runId))
        .orderBy(asc(runSteps.index))
        .all()
        .find((s) => s.isPublish && s.index === 2);
      const parsed = JSON.parse(secondRow?.output as string);
      expect(parsed.articles).toEqual([
        { name: "first", title: "First Article", content_md: "first-content" },
      ]);
    });

    it("skips publishes entirely when the steps: pipeline failed", async () => {
      writeBundle("boom", "#!/bin/sh\nexit 4\n");
      writeBundle(
        "pub-marker",
        '#!/bin/sh\necho pub-ran > "$KIRI_REPO_ROOT/pub-marker"\necho article\n',
      );
      const wf: WorkflowDefinition = {
        name: "pub-after-fail",
        steps: [{ use: "boom" }],
        publish: [{ name: "art", use: "pub-marker" }],
      };

      const result = await runWorkflow(db, wf, { cwd }).done;
      expect(result.status).toBe("failed");

      // No publish row inserted; the marker file was never created.
      expect(existsSync(join(cwd, "pub-marker"))).toBe(false);
      const stepsRows = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).all();
      expect(stepsRows.some((s) => s.isPublish)).toBe(false);
    });

    it("skips publishes entirely when the run is cancelled", async () => {
      const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 100 });
      writeBundle(
        "pub-marker",
        '#!/bin/sh\necho pub-ran > "$KIRI_REPO_ROOT/pub-marker"\necho article\n',
      );
      const wf: WorkflowDefinition = {
        name: "cancel-skip-pub",
        steps: [{ sh: "exec 1>&- 2>&-; sleep 5" }],
        publish: [{ name: "art", use: "pub-marker" }],
      };

      const { runId, done } = runWorkflow(db, wf, {
        cwd,
        cancelRegistry,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      cancelRegistry.requestCancel(runId);

      const result = await done;
      expect(result.status).toBe("cancelled");

      // No publish row inserted; the marker file was never created.
      expect(existsSync(join(cwd, "pub-marker"))).toBe(false);
      const stepsRows = db.select().from(runSteps).where(eq(runSteps.runId, runId)).all();
      expect(stepsRows.some((s) => s.isPublish)).toBe(false);
    });

    it("exposes KIRI_RUN_CONTEXT_FILE to publishes with the steps envelope", async () => {
      writeBundle("step", "#!/bin/sh\necho hello\n");
      writeBundle("context-dump", '#!/bin/sh\ncat "$KIRI_RUN_CONTEXT_FILE"\n');
      const wf: WorkflowDefinition = {
        name: "pub-ctx",
        steps: [{ use: "step" }],
        publish: [{ name: "ctx", use: "context-dump" }],
      };

      const result = await runWorkflow(db, wf, { cwd }).done;
      expect(result.status).toBe("ok");

      const publishRow = db
        .select()
        .from(runSteps)
        .where(eq(runSteps.runId, result.runId))
        .orderBy(asc(runSteps.index))
        .all()
        .find((s) => s.isPublish);
      const parsed = JSON.parse(publishRow?.output as string);
      expect(parsed.workflow).toBe("pub-ctx");
      expect(parsed.status).toBe("ok");
      expect(parsed.steps).toEqual([
        expect.objectContaining({ index: 0, kind: "use", use: "step", status: "ok" }),
      ]);
    });

    it("inter-publish cancel halts before the next publish starts; earlier ok publish stays ok", async () => {
      writeBundle("step", "#!/bin/sh\necho one\n");
      writeBundle("first-pub", "#!/bin/sh\necho first-publish\n");
      writeBundle("second-pub", "#!/bin/sh\necho should-not-run\n");
      const wf: WorkflowDefinition = {
        name: "two-pub",
        steps: [{ use: "step" }],
        publish: [
          { name: "first", use: "first-pub" },
          { name: "second", use: "second-pub" },
        ],
      };
      const cancelRegistry = createCancelRegistry();
      const bus = createEventBus();

      // Cancel synchronously when the first publish's `ok` event lands.
      // The publish loop's `isCancelled` check at iteration 2 picks it up.
      let target = "";
      bus.subscribe((e) => {
        if (
          e.type === "run.step.updated" &&
          e.runId === target &&
          e.step === 1 &&
          e.status === "ok"
        ) {
          cancelRegistry.requestCancel(target);
        }
      });

      const { runId, done } = runWorkflow(db, wf, {
        cwd,
        bus,
        cancelRegistry,
      });
      target = runId;

      const result = await done;
      expect(result.status).toBe("cancelled");

      const publishRows = db
        .select()
        .from(runSteps)
        .where(eq(runSteps.runId, runId))
        .orderBy(asc(runSteps.index))
        .all()
        .filter((s) => s.isPublish);
      expect(publishRows).toHaveLength(1);
      expect(publishRows[0].status).toBe("ok");

      const run = db.select().from(runs).where(eq(runs.id, runId)).get();
      expect(run?.error).toEqual({ message: "run cancelled" });
    });

    it("propagates cancel arriving during a publish step to the run status", async () => {
      writeBundle("step", "#!/bin/sh\necho one\n");
      writeBundle("slow-pub", "#!/bin/sh\nexec 1>&- 2>&-; sleep 5\n");
      const wf: WorkflowDefinition = {
        name: "pub-cancel",
        steps: [{ use: "step" }],
        publish: [{ name: "art", use: "slow-pub" }],
      };
      const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 100 });
      const bus = createEventBus();

      let target = "";
      bus.subscribe((e) => {
        if (
          e.type === "run.step.updated" &&
          e.runId === target &&
          e.step === 1 &&
          e.status === "running"
        ) {
          cancelRegistry.requestCancel(target);
        }
      });

      const { runId, done } = runWorkflow(db, wf, {
        cwd,
        bus,
        cancelRegistry,
      });
      target = runId;

      const result = await done;
      expect(result.status).toBe("cancelled");

      const run = db.select().from(runs).where(eq(runs.id, runId)).get();
      expect(run?.status).toBe("cancelled");
      expect(run?.error).toEqual({ message: "run cancelled" });

      const publishRow = db
        .select()
        .from(runSteps)
        .where(eq(runSteps.runId, runId))
        .orderBy(asc(runSteps.index))
        .all()
        .find((s) => s.isPublish);
      expect(publishRow?.status).toBe("cancelled");
      expect(publishRow?.error).toEqual({ message: "run cancelled" });
    });

    it("publishes run.step.updated events for each publish step", async () => {
      writeBundle("step", "#!/bin/sh\necho one\n");
      writeBundle("art", "#!/bin/sh\necho article\n");
      const wf: WorkflowDefinition = {
        name: "pub-events",
        steps: [{ use: "step" }],
        publish: [{ name: "art", use: "art" }],
      };
      const bus = createEventBus();
      const seen: KiriEvent[] = [];
      bus.subscribe((e) => seen.push(e));

      const result = await runWorkflow(db, wf, { cwd, bus }).done;
      expect(result.status).toBe("ok");
      expect(seen).toEqual([
        { type: "run.started", id: result.runId },
        { type: "run.step.updated", runId: result.runId, step: 0, status: "running" },
        { type: "run.step.updated", runId: result.runId, step: 0, status: "ok" },
        { type: "run.step.updated", runId: result.runId, step: 1, status: "running" },
        { type: "run.step.updated", runId: result.runId, step: 1, status: "ok" },
        { type: "run.updated", id: result.runId, status: "ok" },
        { type: "run.finished", id: result.runId, status: "ok", workflowName: "pub-events" },
      ]);
    });
  });

  describe("rerun (existing runId)", () => {
    it("reuses the row and refreshes the snapshot in place", async () => {
      writeBundle("boom", "#!/bin/sh\necho oops\nexit 7\n");
      writeBundle("hi", "#!/bin/sh\necho ok\n");

      const failing = makeWorkflow("rerun-target", useSteps("boom"));
      const first = await runWorkflow(db, failing, { cwd }).done;
      expect(first.status).toBe("failed");

      const original = db.select().from(runs).where(eq(runs.id, first.runId)).get();
      if (!original) throw new Error("expected first run row to exist");
      expect(original.error).not.toBeNull();
      const originalStartedAt = original.startedAt;

      // The endpoint will wipe step rows before invoking; mirror that here so
      // the rerun assertion lands on a clean post-rerun row count.
      db.delete(runSteps).where(eq(runSteps.runId, first.runId)).run();

      // Sleep a tick so the refreshed startedAt is strictly newer.
      await new Promise((resolve) => setTimeout(resolve, 5));

      const succeeding = makeWorkflow("rerun-target", useSteps("hi"));
      const second = await runWorkflow(db, succeeding, {
        cwd,
        runId: first.runId,
      }).done;

      expect(second.runId).toBe(first.runId);
      expect(second.status).toBe("ok");

      const allRowsForId = db.select().from(runs).where(eq(runs.id, first.runId)).all();
      expect(allRowsForId).toHaveLength(1);

      const refreshed = allRowsForId[0];
      expect(refreshed.status).toBe("ok");
      expect(refreshed.error).toBeNull();
      expect(refreshed.startedAt.getTime()).toBeGreaterThan(originalStartedAt.getTime());
      expect(refreshed.definitionSnapshot).toMatchObject({
        name: "rerun-target",
        steps: [{ use: "hi" }],
      });

      const stepRows = db.select().from(runSteps).where(eq(runSteps.runId, first.runId)).all();
      expect(stepRows).toHaveLength(1);
      expect(stepRows[0].status).toBe("ok");
      expect(stepRows[0].output).toBe("ok\n");
    });

    it("clears finishedAt/error/summary on the row when rerunning", async () => {
      writeBundle("fail", "#!/bin/sh\nexit 3\n");
      const wf = makeWorkflow("clear-fields", useSteps("fail"));

      const first = await runWorkflow(db, wf, { cwd }).done;
      expect(first.status).toBe("failed");

      const before = db.select().from(runs).where(eq(runs.id, first.runId)).get();
      expect(before?.finishedAt).toBeInstanceOf(Date);
      expect(before?.error).not.toBeNull();

      db.delete(runSteps).where(eq(runSteps.runId, first.runId)).run();

      // Bundle that hangs long enough to observe the runner mid-flight,
      // then exits ok. We assert the row is in `running` with cleared
      // terminal fields immediately after the synchronous setup.
      writeBundle("slow-ok", "#!/bin/sh\nsleep 0.05\necho done\n");
      const wf2 = makeWorkflow("clear-fields", useSteps("slow-ok"));
      const { done } = runWorkflow(db, wf2, { cwd, runId: first.runId });

      const midflight = db.select().from(runs).where(eq(runs.id, first.runId)).get();
      expect(midflight?.status).toBe("running");
      expect(midflight?.finishedAt).toBeNull();
      expect(midflight?.error).toBeNull();
      expect(midflight?.summary).toBeNull();

      await done;
    });
  });

  describe("inputs", () => {
    it("snapshots null on runs.inputs when the workflow declares no inputs:", async () => {
      writeBundle("hello", "#!/bin/sh\necho hi\n");
      const wf = makeWorkflow("no-inputs", useSteps("hello"));

      const result = await runWorkflow(db, wf, { cwd }).done;

      const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
      expect(run?.inputs).toBeNull();
    });

    it("snapshots the supplied values onto runs.inputs verbatim", async () => {
      writeBundle("hello", "#!/bin/sh\necho hi\n");
      const wf: WorkflowDefinition = {
        name: "snapshot-supplied",
        inputs: [{ name: "pr_number" }, { name: "owner" }],
        steps: [{ use: "hello" }],
      };

      const result = await runWorkflow(db, wf, {
        cwd,
        inputs: { pr_number: "42", owner: "kiri" },
      }).done;

      const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
      expect(run?.inputs).toEqual({ pr_number: "42", owner: "kiri" });
    });

    it("falls back to each input's default when no value is supplied", async () => {
      writeBundle("hello", "#!/bin/sh\necho hi\n");
      const wf: WorkflowDefinition = {
        name: "default-only",
        inputs: [
          { name: "branch", default: "main" },
          { name: "owner", default: "kiri" },
        ],
        steps: [{ use: "hello" }],
      };

      const result = await runWorkflow(db, wf, { cwd }).done;

      const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
      expect(run?.inputs).toEqual({ branch: "main", owner: "kiri" });
    });

    it("prefers a supplied value over the input's default", async () => {
      writeBundle("hello", "#!/bin/sh\necho hi\n");
      const wf: WorkflowDefinition = {
        name: "supplied-wins",
        inputs: [{ name: "branch", default: "main" }],
        steps: [{ use: "hello" }],
      };

      const result = await runWorkflow(db, wf, {
        cwd,
        inputs: { branch: "release" },
      }).done;

      const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
      expect(run?.inputs).toEqual({ branch: "release" });
    });

    it("omits declared inputs that resolved to neither a value nor a default", async () => {
      writeBundle("hello", "#!/bin/sh\necho hi\n");
      // `pr_number` is unsupplied and has no default; `owner` defaults to
      // "kiri". The snapshot records only the resolvable entry — required-
      // input enforcement lives on the invoke API, not the runner.
      const wf: WorkflowDefinition = {
        name: "partial",
        inputs: [{ name: "pr_number" }, { name: "owner", default: "kiri" }],
        steps: [{ use: "hello" }],
      };

      const result = await runWorkflow(db, wf, { cwd }).done;

      const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
      expect(run?.inputs).toEqual({ owner: "kiri" });
    });

    it("resolves a ref-only env entry on a regular step", async () => {
      writeBundle("dump", '#!/bin/sh\necho "PR=$PR"\n');
      const wf: WorkflowDefinition = {
        name: "ref-only",
        inputs: [{ name: "pr_number" }],
        steps: [{ use: "dump", env: { PR: { input: "pr_number" } } }],
      };

      const result = await runWorkflow(db, wf, {
        cwd,
        inputs: { pr_number: "42" },
      }).done;

      expect(result.status).toBe("ok");
      const step = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).get();
      expect(step?.output).toBe("PR=42\n");
    });

    it("resolves a mix of literal and ref env entries on the same step", async () => {
      writeBundle("dump", '#!/bin/sh\necho "STATIC=$STATIC PR=$PR"\n');
      const wf: WorkflowDefinition = {
        name: "mixed-env",
        inputs: [{ name: "pr_number" }],
        steps: [
          {
            use: "dump",
            env: { STATIC: "literal", PR: { input: "pr_number" } },
          },
        ],
      };

      const result = await runWorkflow(db, wf, {
        cwd,
        inputs: { pr_number: "7" },
      }).done;

      expect(result.status).toBe("ok");
      const step = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).get();
      expect(step?.output).toBe("STATIC=literal PR=7\n");
    });

    it("resolves env refs from the input's default when no value is supplied", async () => {
      writeBundle("dump", '#!/bin/sh\necho "BRANCH=$BRANCH"\n');
      const wf: WorkflowDefinition = {
        name: "default-resolves",
        inputs: [{ name: "branch", default: "main" }],
        steps: [{ use: "dump", env: { BRANCH: { input: "branch" } } }],
      };

      const result = await runWorkflow(db, wf, { cwd }).done;

      expect(result.status).toBe("ok");
      const step = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).get();
      expect(step?.output).toBe("BRANCH=main\n");
    });

    it("kiri-injected vars still win when an input ref aliases a reserved key", async () => {
      // KIRI_-prefixed keys are blocked by the schema, so PATH is the
      // cleanest user-controllable collision target: a step can declare a
      // PATH env entry that resolves from an input, but the kiri overlay
      // still wins.
      writeBundle("path", '#!/bin/sh\necho "PATH=$PATH"\n');
      const wf: WorkflowDefinition = {
        name: "ref-collision",
        inputs: [{ name: "evil_path", default: "/sneaky/bin" }],
        steps: [{ use: "path", env: { PATH: { input: "evil_path" } } }],
      };

      const result = await runWorkflow(db, wf, { cwd }).done;

      const step = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).get();
      expect(step?.output).toBe(`PATH=${process.env.PATH ?? ""}\n`);
    });

    it("resolves env refs on a summarize: entry", async () => {
      writeBundle("step", "#!/bin/sh\necho one\n");
      writeBundle("summer", '#!/bin/sh\necho "SUMMARY-BRANCH=$BRANCH"\n');
      const wf: WorkflowDefinition = {
        name: "summer-ref",
        inputs: [{ name: "branch" }],
        steps: [{ use: "step" }],
        summarize: { use: "summer", env: { BRANCH: { input: "branch" } } },
      };

      const result = await runWorkflow(db, wf, {
        cwd,
        inputs: { branch: "release" },
      }).done;

      expect(result.status).toBe("ok");
      const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
      expect(run?.summary).toBe("SUMMARY-BRANCH=release");
    });

    it("resolves env refs on a publish: entry", async () => {
      writeBundle("step", "#!/bin/sh\necho one\n");
      writeBundle("digest", '#!/bin/sh\necho "DIGEST-PR=$PR"\n');
      const wf: WorkflowDefinition = {
        name: "pub-ref",
        inputs: [{ name: "pr_number" }],
        steps: [{ use: "step" }],
        publish: [{ name: "digest", use: "digest", env: { PR: { input: "pr_number" } } }],
      };

      const result = await runWorkflow(db, wf, {
        cwd,
        inputs: { pr_number: "9" },
      }).done;

      expect(result.status).toBe("ok");
      const articleRows = db.select().from(articles).where(eq(articles.runId, result.runId)).all();
      expect(articleRows).toHaveLength(1);
      expect(articleRows[0].contentMd).toBe("DIGEST-PR=9");
    });

    it("re-snapshots runs.inputs on the rerun path from the supplied values", async () => {
      writeBundle("hello", "#!/bin/sh\necho hi\n");
      const wf: WorkflowDefinition = {
        name: "rerun-inputs",
        inputs: [{ name: "pr_number" }],
        steps: [{ use: "hello" }],
      };

      const first = await runWorkflow(db, wf, {
        cwd,
        inputs: { pr_number: "1" },
      }).done;
      expect(first.status).toBe("ok");

      const before = db.select().from(runs).where(eq(runs.id, first.runId)).get();
      expect(before?.inputs).toEqual({ pr_number: "1" });

      db.delete(runSteps).where(eq(runSteps.runId, first.runId)).run();

      const second = await runWorkflow(db, wf, {
        cwd,
        runId: first.runId,
        inputs: { pr_number: "2" },
      }).done;
      expect(second.runId).toBe(first.runId);
      expect(second.status).toBe("ok");

      const after = db.select().from(runs).where(eq(runs.id, first.runId)).get();
      expect(after?.inputs).toEqual({ pr_number: "2" });
    });
  });

  describe("recommendations", () => {
    const withSilencedWarn = async <T>(
      fn: () => Promise<T>,
    ): Promise<{ result: T; warnings: string[] }> => {
      const warnings: string[] = [];
      const original = console.warn;
      console.warn = (msg: unknown) => {
        warnings.push(String(msg));
      };
      try {
        const result = await fn();
        return { result, warnings };
      } finally {
        console.warn = original;
      }
    };

    it("ingests a single recommendation line emitted by a main step", async () => {
      writeBundle(
        "emit-one",
        `#!/bin/sh
echo '{"title":"Review PR #1","workflow":"pr-review","description":"+10/-2","inputs":{"pr_number":"1"}}' > "$KIRI_RECOMMENDATIONS_FILE"
`,
      );
      const wf = makeWorkflow("single", useSteps("emit-one"));

      const result = await runWorkflow(db, wf, { cwd }).done;
      expect(result.status).toBe("ok");

      const rows = db
        .select()
        .from(recommendations)
        .where(eq(recommendations.runId, result.runId))
        .all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        runId: result.runId,
        index: 0,
        title: "Review PR #1",
        description: "+10/-2",
        workflow: "pr-review",
        inputs: { pr_number: "1" },
        actionedRunId: null,
        actionedAt: null,
      });
    });

    it("ingests multiple lines preserving emission order", async () => {
      writeBundle(
        "emit-many",
        `#!/bin/sh
cat > "$KIRI_RECOMMENDATIONS_FILE" <<'EOF'
{"title":"A","workflow":"w","description":"first","inputs":{"x":"1"}}
{"title":"B","workflow":"w"}
{"title":"C","workflow":"w"}
EOF
`,
      );
      const wf = makeWorkflow("many", useSteps("emit-many"));

      const result = await runWorkflow(db, wf, { cwd }).done;
      expect(result.status).toBe("ok");

      const rows = db
        .select()
        .from(recommendations)
        .where(eq(recommendations.runId, result.runId))
        .orderBy(asc(recommendations.index))
        .all();
      expect(
        rows.map((r) => ({
          index: r.index,
          title: r.title,
          description: r.description,
          inputs: r.inputs,
        })),
      ).toEqual([
        { index: 0, title: "A", description: "first", inputs: { x: "1" } },
        { index: 1, title: "B", description: null, inputs: null },
        { index: 2, title: "C", description: null, inputs: null },
      ]);
    });

    it("is a no-op when the step does not write a recommendations file", async () => {
      writeBundle("no-emit", "#!/bin/sh\necho nothing\n");
      const wf = makeWorkflow("silent", useSteps("no-emit"));

      const result = await runWorkflow(db, wf, { cwd }).done;
      expect(result.status).toBe("ok");

      const rows = db
        .select()
        .from(recommendations)
        .where(eq(recommendations.runId, result.runId))
        .all();
      expect(rows).toHaveLength(0);
    });

    it("skips the recommendations file of a failed step", async () => {
      writeBundle(
        "emit-then-fail",
        `#!/bin/sh
echo '{"title":"X","workflow":"w"}' > "$KIRI_RECOMMENDATIONS_FILE"
exit 1
`,
      );
      const wf = makeWorkflow("failer", useSteps("emit-then-fail"));

      const result = await runWorkflow(db, wf, { cwd }).done;
      expect(result.status).toBe("failed");

      const rows = db
        .select()
        .from(recommendations)
        .where(eq(recommendations.runId, result.runId))
        .all();
      expect(rows).toHaveLength(0);
    });

    it("skips the recommendations file of a cancelled step", async () => {
      const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 100 });
      // exec 1>&- 2>&- closes sh's stdio before sleep is forked so the
      // pipe readers get EOF when sh dies — without this the orphaned
      // sleep holds stdout open and the runner hangs on macOS/Linux CI.
      const wf: WorkflowDefinition = {
        name: "cancelled-emit",
        steps: [
          {
            sh: `echo '{"title":"X","workflow":"w"}' > "$KIRI_RECOMMENDATIONS_FILE"; exec 1>&- 2>&-; sleep 5`,
          },
        ],
      };

      const { runId, done } = runWorkflow(db, wf, { cwd, cancelRegistry });
      await new Promise((r) => setTimeout(r, 50));
      expect(cancelRegistry.requestCancel(runId)).toBe(true);
      const result = await done;

      expect(result.status).toBe("cancelled");

      const rows = db
        .select()
        .from(recommendations)
        .where(eq(recommendations.runId, result.runId))
        .all();
      expect(rows).toHaveLength(0);
    });

    it("skips a malformed JSON line and ingests the surrounding valid lines", async () => {
      writeBundle(
        "emit-mixed-json",
        `#!/bin/sh
cat > "$KIRI_RECOMMENDATIONS_FILE" <<'EOF'
{"title":"Good","workflow":"w"}
not-json-at-all
{"title":"Also good","workflow":"w"}
EOF
`,
      );
      const wf = makeWorkflow("malformed", useSteps("emit-mixed-json"));

      const { result, warnings } = await withSilencedWarn(() => runWorkflow(db, wf, { cwd }).done);
      expect(result.status).toBe("ok");
      expect(warnings.some((w) => w.includes("malformed recommendation"))).toBe(true);

      const rows = db
        .select()
        .from(recommendations)
        .where(eq(recommendations.runId, result.runId))
        .orderBy(asc(recommendations.index))
        .all();
      expect(rows.map((r) => ({ index: r.index, title: r.title }))).toEqual([
        { index: 0, title: "Good" },
        { index: 1, title: "Also good" },
      ]);
    });

    it("skips a schema-failing line and ingests the surrounding valid lines", async () => {
      writeBundle(
        "emit-mixed-schema",
        `#!/bin/sh
cat > "$KIRI_RECOMMENDATIONS_FILE" <<'EOF'
{"title":"Good","workflow":"w"}
{"title":"Missing workflow"}
{"title":"Also good","workflow":"w"}
EOF
`,
      );
      const wf = makeWorkflow("schemafail", useSteps("emit-mixed-schema"));

      const { result, warnings } = await withSilencedWarn(() => runWorkflow(db, wf, { cwd }).done);
      expect(result.status).toBe("ok");
      expect(warnings.some((w) => w.includes("failing schema"))).toBe(true);

      const rows = db
        .select()
        .from(recommendations)
        .where(eq(recommendations.runId, result.runId))
        .orderBy(asc(recommendations.index))
        .all();
      expect(rows.map((r) => ({ index: r.index, title: r.title }))).toEqual([
        { index: 0, title: "Good" },
        { index: 1, title: "Also good" },
      ]);
    });

    it("does not inject KIRI_RECOMMENDATIONS_FILE on publish steps", async () => {
      writeBundle("source", "#!/bin/sh\necho hi\n");
      writeBundle("pub-echo-env", '#!/bin/sh\necho "REC=$KIRI_RECOMMENDATIONS_FILE"\n');
      const wf: WorkflowDefinition = {
        name: "pub-no-rec",
        steps: useSteps("source"),
        publish: [{ name: "article", use: "pub-echo-env" }],
      };

      const result = await runWorkflow(db, wf, { cwd }).done;
      expect(result.status).toBe("ok");

      const stepRows = db
        .select()
        .from(runSteps)
        .where(eq(runSteps.runId, result.runId))
        .orderBy(asc(runSteps.index))
        .all();
      const publishStep = stepRows.find((s) => s.isPublish);
      // Empty expansion of the missing var produces a bare "REC=" line.
      expect(publishStep?.output).toBe("REC=\n");

      const rows = db
        .select()
        .from(recommendations)
        .where(eq(recommendations.runId, result.runId))
        .all();
      expect(rows).toHaveLength(0);
    });

    it("does not inject KIRI_RECOMMENDATIONS_FILE on the summariser", async () => {
      writeBundle("source", "#!/bin/sh\necho hi\n");
      writeBundle("sum-echo-env", '#!/bin/sh\necho "REC=$KIRI_RECOMMENDATIONS_FILE"\n');
      const wf: WorkflowDefinition = {
        name: "sum-no-rec",
        steps: useSteps("source"),
        summarize: { use: "sum-echo-env" },
      };

      const result = await runWorkflow(db, wf, { cwd }).done;
      expect(result.status).toBe("ok");

      const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
      // Summary captures the trimmed stdout of the summariser step.
      expect(run?.summary).toBe("REC=");

      const rows = db
        .select()
        .from(recommendations)
        .where(eq(recommendations.runId, result.runId))
        .all();
      expect(rows).toHaveLength(0);
    });

    it("preserves emission order across multiple emitting steps", async () => {
      writeBundle(
        "emit-ab",
        `#!/bin/sh
cat > "$KIRI_RECOMMENDATIONS_FILE" <<'EOF'
{"title":"A","workflow":"w"}
{"title":"B","workflow":"w"}
EOF
`,
      );
      writeBundle(
        "emit-c",
        `#!/bin/sh
echo '{"title":"C","workflow":"w"}' > "$KIRI_RECOMMENDATIONS_FILE"
`,
      );
      const wf = makeWorkflow("cross-step", useSteps("emit-ab", "emit-c"));

      const result = await runWorkflow(db, wf, { cwd }).done;
      expect(result.status).toBe("ok");

      const rows = db
        .select()
        .from(recommendations)
        .where(eq(recommendations.runId, result.runId))
        .orderBy(asc(recommendations.index))
        .all();
      expect(rows.map((r) => ({ index: r.index, title: r.title }))).toEqual([
        { index: 0, title: "A" },
        { index: 1, title: "B" },
        { index: 2, title: "C" },
      ]);
    });
  });
});
