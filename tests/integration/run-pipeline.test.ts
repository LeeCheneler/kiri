import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { bootstrap } from "../../src/server/bootstrap.ts";
import type { KiriDb } from "../../src/server/db/index.ts";
import { runSteps, runs } from "../../src/server/db/schema.ts";
import { runWorkflow } from "../../src/server/runner/run-workflow.ts";
import { loadWorkflows } from "../../src/server/workflows/index.ts";

/**
 * End-to-end integration tests for the run pipeline: YAML on disk →
 * loader → runWorkflow → DB. Exercises sh-step variations through the
 * full path so a regression in the loader, runner, or persistence layer
 * surfaces as a behavioural failure (not just a unit-level assertion).
 *
 * Bundle-specific scenarios live in `claude-code-bundle.test.ts`.
 */
describe("run pipeline", () => {
  let cwd: string;
  let db: KiriDb;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-int-pipeline-"));
    db = bootstrap(cwd);
    mkdirSync(join(cwd, "workflows"), { recursive: true });
  });

  afterEach(() => {
    db.$client.close();
    rmSync(cwd, { recursive: true, force: true });
  });

  const writeWorkflow = (name: string, body: string): void => {
    writeFileSync(join(cwd, "workflows", `${name}.yaml`), body);
  };

  const loadAndRun = async (name: string) => {
    const result = await loadWorkflows(join(cwd, "workflows"), cwd);
    expect(result.failures).toEqual([]);
    const def = result.workflows.get(name);
    if (!def) throw new Error(`workflow not found: ${name}`);
    return runWorkflow(db, def, { cwd, trigger: "manual" }).done;
  };

  it("runs a single sh step, captures stdout, and persists the run as ok", async () => {
    writeWorkflow("hello", 'name: hello\nsteps:\n  - sh: echo "hello world"\n');

    const result = await loadAndRun("hello");

    expect(result.status).toBe("ok");
    const run = db.select().from(runs).where(eq(runs.id, result.runId)).get();
    expect(run?.status).toBe("ok");
    expect(run?.error).toBeNull();

    const step = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).get();
    expect(step?.status).toBe("ok");
    expect(step?.kind).toBe("sh");
    expect(step?.output).toBe("hello world\n");
  });

  it("pipes stdout from one sh step into the next step's stdin", async () => {
    writeWorkflow("pipe", 'name: pipe\nsteps:\n  - sh: echo "first"\n  - sh: cat\n');

    const result = await loadAndRun("pipe");

    expect(result.status).toBe("ok");
    const stepRows = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).all();
    expect(stepRows).toHaveLength(2);
    expect(stepRows[0].output).toBe("first\n");
    // `cat` reads stdin (stdout from step 0) and re-emits it.
    expect(stepRows[1].output).toBe("first\n");
  });

  it("halts on a failing sh step and does not insert later step rows", async () => {
    writeWorkflow(
      "fail-mid",
      'name: fail-mid\nsteps:\n  - sh: echo "first"\n  - sh: exit 7\n  - sh: echo "never"\n',
    );

    const result = await loadAndRun("fail-mid");

    expect(result.status).toBe("failed");
    const stepRows = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).all();
    expect(stepRows).toHaveLength(2);
    expect(stepRows[0].status).toBe("ok");
    expect(stepRows[1].status).toBe("failed");
    expect(stepRows[1].error).toMatchObject({ message: expect.stringContaining("7") });
  });

  it("forwards step-level env to the spawned shell", async () => {
    writeWorkflow(
      "env",
      'name: env\nsteps:\n  - sh: echo "GREETING=$GREETING"\n    env:\n      GREETING: hello\n',
    );

    const result = await loadAndRun("env");

    expect(result.status).toBe("ok");
    const step = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).get();
    expect(step?.output).toBe("GREETING=hello\n");
  });

  it("exposes KIRI_RUN_ID and KIRI_STEP_INDEX to sh steps", async () => {
    writeWorkflow(
      "kiri-env",
      'name: kiri-env\nsteps:\n  - sh: echo "RUN=$KIRI_RUN_ID STEP=$KIRI_STEP_INDEX"\n  - sh: echo "STEP=$KIRI_STEP_INDEX"\n',
    );

    const result = await loadAndRun("kiri-env");

    expect(result.status).toBe("ok");
    const stepRows = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).all();
    expect(stepRows[0].output).toBe(`RUN=${result.runId} STEP=0\n`);
    expect(stepRows[1].output).toBe("STEP=1\n");
  });

  it("captures stderr and stdout independently on the step traces", async () => {
    writeWorkflow(
      "streams",
      'name: streams\nsteps:\n  - sh: echo "to-stdout"; echo "to-stderr" 1>&2\n',
    );

    const result = await loadAndRun("streams");

    expect(result.status).toBe("ok");
    const step = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).get();
    expect(step?.traces).toMatchObject({ stdout: "to-stdout\n", stderr: "to-stderr\n" });
  });
});
