import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { KiriDb } from "../db/index.ts";
import { runSteps, runs } from "../db/schema.ts";
import { type WorkflowDefinition, type WorkflowStep, isUseStep } from "../workflows/index.ts";
import { runStep } from "./run-step.ts";

export interface RunWorkflowArgs {
  /** Repo root. Bundles resolve under `<cwd>/scripts/<name>/run.sh`; the scratch dir lives at `<cwd>/.kiri/runs/<run-id>/`. */
  cwd: string;
  /** Where the run was triggered from — recorded on the `runs` row. Currently `"manual"`; cron and MCP triggers will use distinct values. */
  trigger: string;
}

export interface RunWorkflowResult {
  runId: string;
  status: "ok" | "failed";
}

/** Persisted on the `runs` row. Shallow-cloned so the in-memory registry entry can mutate without affecting historical rows. */
interface DefinitionSnapshot {
  name: string;
  steps: WorkflowStep[];
  gating?: "auto" | "propose";
  schedule?: string;
}

/**
 * Per-step materials snapshot persisted to `run_steps.materials`.
 *
 * - `use:` steps capture every file in the bundle directory keyed by
 *   path relative to the bundle (top-level files only — sub-directories
 *   skipped for now since no real bundle needs them yet).
 * - `sh:` steps capture the inline shell text under a single `source` key.
 */
type StepMaterials =
  | { kind: "use"; bundle: string; files: Record<string, string> }
  | { kind: "sh"; source: string };

const snapshotDefinition = (def: WorkflowDefinition): DefinitionSnapshot => ({
  name: def.name,
  steps: def.steps.map((s) => ({ ...s })),
  gating: def.gating,
  schedule: def.schedule,
});

const snapshotBundle = (bundleDir: string): Record<string, string> => {
  let entries: string[];
  try {
    entries = readdirSync(bundleDir);
  } catch {
    // Missing or unreadable bundle dir: record an empty snapshot. The
    // spawn will fail with the same root cause and surface it via the
    // envelope.
    return {};
  }
  const files: Record<string, string> = {};
  for (const name of entries) {
    const abs = join(bundleDir, name);
    if (!statSync(abs).isFile()) continue;
    files[name] = readFileSync(abs, "utf8");
  }
  return files;
};

const captureMaterials = (step: WorkflowStep, cwd: string): StepMaterials => {
  if (isUseStep(step)) {
    const bundleDir = join(cwd, "scripts", step.use);
    return { kind: "use", bundle: step.use, files: snapshotBundle(bundleDir) };
  }
  return { kind: "sh", source: step.sh };
};

const buildEnv = (
  step: WorkflowStep,
  runId: string,
  stepIndex: number,
  cwd: string,
  scratchDir: string,
): Record<string, string> => {
  // User env is applied first; kiri- and OS-controlled vars overwrite on
  // collision so a workflow can't redirect PATH or shadow KIRI_ identity.
  const env: Record<string, string> = { ...(step.env ?? {}) };
  env.PATH = process.env.PATH ?? "";
  env.HOME = process.env.HOME ?? "";
  // USER/LOGNAME are POSIX user-identity vars; tools that authenticate as
  // the user (macOS Keychain lookups, ssh-agent, gpg) rely on them to
  // resolve the active user's session — same category as HOME, not
  // orchestrator state.
  env.USER = process.env.USER ?? "";
  env.LOGNAME = process.env.LOGNAME ?? "";
  env.KIRI_RUN_ID = runId;
  env.KIRI_STEP_INDEX = String(stepIndex);
  env.KIRI_REPO_ROOT = cwd;
  env.KIRI_META_FILE = join(scratchDir, `step-${stepIndex}.meta.json`);
  // use: steps run with cwd = scratchDir, so the bundle can't reach its
  // own sidecar files via relative paths. KIRI_BUNDLE_DIR points at the
  // bundle source; sh: steps don't have a bundle so it stays unset.
  if (isUseStep(step)) env.KIRI_BUNDLE_DIR = join(cwd, "scripts", step.use);
  return env;
};

/**
 * Execute a workflow definition's linear step list.
 *
 * Lifecycle, in order: insert `runs` with the definition snapshot →
 * create the per-run scratch dir → for each step, capture materials and
 * insert `run_steps` *before* spawning → execute the step → update the
 * row with the envelope → halt on first failure → finalize the `runs`
 * row → remove the scratch dir.
 *
 * Snapshot rows always reflect the bytes that ran, even if the bundle
 * file is later edited or deleted. Halt-on-failure: a failed step leaves
 * later steps uncreated, and the run is marked failed.
 */
export async function runWorkflow(
  db: KiriDb,
  definition: WorkflowDefinition,
  args: RunWorkflowArgs,
): Promise<RunWorkflowResult> {
  const runId = crypto.randomUUID();
  const scratchDir = join(args.cwd, ".kiri", "runs", runId);

  db.insert(runs)
    .values({
      id: runId,
      workflowName: definition.name,
      status: "running",
      trigger: args.trigger,
      startedAt: new Date(),
      definitionSnapshot: snapshotDefinition(definition),
    })
    .run();

  let status: "ok" | "failed" = "ok";
  let runError: { message: string; stack?: string } | undefined;
  let caughtThrow: unknown;

  try {
    mkdirSync(scratchDir, { recursive: true });
    let input = "";
    for (let i = 0; i < definition.steps.length; i++) {
      const step = definition.steps[i];
      const materials = captureMaterials(step, args.cwd);

      const stepId = crypto.randomUUID();
      db.insert(runSteps)
        .values({
          id: stepId,
          runId,
          index: i,
          kind: isUseStep(step) ? "use" : "sh",
          status: "running",
          materials,
        })
        .run();

      const envelope = await runStep({
        step,
        cwd: args.cwd,
        scratchDir,
        input,
        env: buildEnv(step, runId, i, args.cwd, scratchDir),
      });

      db.update(runSteps)
        .set({
          status: envelope.status,
          output: envelope.output,
          error: envelope.error ?? null,
          traces: envelope.traces,
        })
        .where(eq(runSteps.id, stepId))
        .run();

      if (envelope.status === "failed") {
        status = "failed";
        // runStep always populates error on a failed envelope.
        runError = envelope.error;
        break;
      }
      input = envelope.output;
    }
  } catch (cause) {
    // mkdirSync, drizzle, or any future surface that throws lands here.
    // Finalize state below before re-throwing so the runs row is never
    // stranded in "running".
    caughtThrow = cause;
    status = "failed";
    runError =
      cause instanceof Error
        ? { message: cause.message, stack: cause.stack }
        : { message: String(cause) };
  }

  db.update(runs)
    .set({ status, finishedAt: new Date(), error: runError ?? null })
    .where(eq(runs.id, runId))
    .run();
  rmSync(scratchDir, { recursive: true, force: true });

  if (caughtThrow !== undefined) throw caughtThrow;
  return { runId, status };
}
