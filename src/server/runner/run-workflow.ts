import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { resolvePublishTitle } from "../../shared/publish-title.ts";
import type { KiriDb } from "../db/index.ts";
import { runArtefacts, runSteps, runs } from "../db/schema.ts";
import type { EventBus } from "../events/index.ts";
import {
  type PublishEntry,
  type WorkflowDefinition,
  type WorkflowStep,
  isUsePublish,
  isUseStep,
} from "../workflows/index.ts";
import type { CancelRegistry } from "./cancel-registry.ts";
import { runStep } from "./run-step.ts";

export interface RunWorkflowArgs {
  /** Repo root. Bundles resolve under `<cwd>/scripts/<name>/run.sh`; the scratch dir lives at `<cwd>/.kiri/runs/<run-id>/`. */
  cwd: string;
  /** Where the run was triggered from — recorded on the `runs` row. Currently `"manual"`; cron and MCP triggers will use distinct values. */
  trigger: string;
  /** Optional event bus. When supplied, the runner publishes lifecycle events at run/step transitions. */
  bus?: EventBus;
  /** Optional cancel registry. When supplied, the runner registers the run, publishes the active step's child handle for SIGTERM/SIGKILL, checks for cancellation between steps, and translates a cancel-induced step failure into a `cancelled` terminal status. */
  cancelRegistry?: CancelRegistry;
}

export interface RunWorkflowResult {
  runId: string;
  status: "ok" | "failed" | "cancelled";
}

const CANCELLED_ERROR = { message: "run cancelled" } as const;

/**
 * Handle on a started run. `runId` is generated and the `runs` row is
 * inserted synchronously, so it can be returned to API callers right away;
 * `done` resolves once the workflow has reached a terminal status (or
 * rejects with the same throw that `runWorkflow` used to surface).
 */
export interface StartedRun {
  runId: string;
  done: Promise<RunWorkflowResult>;
}

/** Persisted on the `runs` row. Shallow-cloned so the in-memory registry entry can mutate without affecting historical rows. */
interface DefinitionSnapshot {
  name: string;
  steps: WorkflowStep[];
  gating?: "auto" | "propose";
  schedule?: string;
  summarize?: WorkflowStep;
  publish?: PublishEntry[];
}

/**
 * Per-step record accumulated during execution and serialised into the
 * run-context JSON file the summariser reads. Carries each step's
 * outcome so the summariser has full context without a DB round-trip.
 */
type ExecutedStep = ({ kind: "use"; use: string } | { kind: "sh"; sh: string }) & {
  index: number;
  status: "ok" | "failed" | "cancelled";
  durationMs: number;
  stdout: string;
  stderr: string;
  error: { message: string; stack?: string } | null;
};

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
  summarize: def.summarize ? { ...def.summarize } : undefined,
  publish: def.publish ? def.publish.map((p) => ({ ...p })) : undefined,
});

const publishAsStep = (entry: PublishEntry): WorkflowStep =>
  isUsePublish(entry) ? { use: entry.use, env: entry.env } : { sh: entry.sh, env: entry.env };

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
 * Start a workflow run.
 *
 * The `runs` row and `runId` are created synchronously so API callers can
 * navigate to the run detail page immediately and watch live events.
 * Step execution and finalisation continue in the background; await `done`
 * when the caller needs the terminal status (e.g. cron, tests).
 *
 * Lifecycle, in order: insert `runs` with the definition snapshot →
 * create the per-run scratch dir → for each step, capture materials and
 * insert `run_steps` *before* spawning → execute the step → update the
 * row with the envelope → halt on first failure → finalize the `runs`
 * row → remove the scratch dir.
 *
 * Snapshot rows always reflect the bytes that ran, even if the bundle
 * file is later edited or deleted. Halt-on-failure: a failed step leaves
 * later steps uncreated, and the run is marked failed. `done` rejects if
 * any non-envelope surface (mkdir, drizzle) throws — the `runs` row is
 * still finalised to "failed" before the rejection.
 */
export function runWorkflow(
  db: KiriDb,
  definition: WorkflowDefinition,
  args: RunWorkflowArgs,
): StartedRun {
  const runId = crypto.randomUUID();
  const scratchDir = join(args.cwd, ".kiri", "runs", runId);
  const startedAt = new Date();

  db.insert(runs)
    .values({
      id: runId,
      workflowName: definition.name,
      status: "running",
      trigger: args.trigger,
      startedAt,
      definitionSnapshot: snapshotDefinition(definition),
    })
    .run();

  // Register synchronously so a cancel request received between this
  // function returning and the executor's first await never sees a
  // running DB row that the registry doesn't know about.
  args.cancelRegistry?.register(runId);
  args.bus?.publish({ type: "run.started", id: runId });

  const done = (async (): Promise<RunWorkflowResult> => {
    let status: "ok" | "failed" | "cancelled" = "ok";
    let runError: { message: string; stack?: string } | undefined;
    let caughtThrow: unknown;
    let summaryText: string | null = null;
    const executed: ExecutedStep[] = [];
    const publishedArtefacts: { name: string; title: string; content_md: string }[] = [];

    try {
      mkdirSync(scratchDir, { recursive: true });
      let input = "";
      for (let i = 0; i < definition.steps.length; i++) {
        if (args.cancelRegistry?.isCancelled(runId)) break;

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

        args.bus?.publish({ type: "run.step.updated", runId, step: i, status: "running" });

        const envelope = await runStep({
          step,
          cwd: args.cwd,
          scratchDir,
          input,
          env: buildEnv(step, runId, i, args.cwd, scratchDir),
          onSpawn: (proc) => args.cancelRegistry?.setChild(runId, proc),
        });

        // A `failed` envelope produced after cancel was requested is the
        // child reacting to our SIGTERM/SIGKILL — surface it as `cancelled`
        // on the step row so the UI distinguishes "we stopped this" from
        // "the script broke". An `ok` envelope is left as-is even if
        // cancel was requested mid-execution: the step actually finished.
        const cancelled = args.cancelRegistry?.isCancelled(runId) ?? false;
        const stepStatus =
          cancelled && envelope.status === "failed" ? "cancelled" : envelope.status;
        const stepError =
          cancelled && envelope.status === "failed" ? CANCELLED_ERROR : (envelope.error ?? null);

        db.update(runSteps)
          .set({
            status: stepStatus,
            output: envelope.output,
            error: stepError,
            traces: envelope.traces,
          })
          .where(eq(runSteps.id, stepId))
          .run();

        args.bus?.publish({
          type: "run.step.updated",
          runId,
          step: i,
          status: stepStatus,
        });

        const stepIdent: { kind: "use"; use: string } | { kind: "sh"; sh: string } = isUseStep(step)
          ? { kind: "use", use: step.use }
          : { kind: "sh", sh: step.sh };
        executed.push({
          ...stepIdent,
          index: i,
          status: stepStatus,
          durationMs: envelope.traces.durationMs,
          stdout: envelope.traces.stdout,
          stderr: envelope.traces.stderr,
          error: stepError,
        });

        if (envelope.status === "failed") {
          status = cancelled ? "cancelled" : "failed";
          runError = cancelled ? { ...CANCELLED_ERROR } : envelope.error;
          break;
        }
        if (cancelled) break;
        input = envelope.output;
      }

      // Loop ended without a step failure but cancel was requested — either
      // before the first iteration or in the gap after a step's `ok`. The
      // run is cancelled even though no step row was marked so.
      if (status === "ok" && args.cancelRegistry?.isCancelled(runId)) {
        status = "cancelled";
        runError = { ...CANCELLED_ERROR };
      }

      // Publishes run after `steps:` on `ok` and `failed` runs, before the
      // summariser. Each entry goes through the same runStep path. Failure
      // is non-fatal — siblings keep running and `runs.status` is unaffected.
      // Cancel mid-publish flips the run to `cancelled` and halts further work.
      const publishes = definition.publish ?? [];
      for (let pi = 0; pi < publishes.length && status !== "cancelled"; pi++) {
        if (args.cancelRegistry?.isCancelled(runId)) {
          status = "cancelled";
          runError = { ...CANCELLED_ERROR };
          break;
        }

        const entry = publishes[pi];
        const publishStep = publishAsStep(entry);
        const publishIndex = definition.steps.length + pi;
        const materials = captureMaterials(publishStep, args.cwd);

        const stepId = crypto.randomUUID();
        db.insert(runSteps)
          .values({
            id: stepId,
            runId,
            index: publishIndex,
            kind: isUseStep(publishStep) ? "use" : "sh",
            status: "running",
            materials,
            isPublish: true,
          })
          .run();

        args.bus?.publish({
          type: "run.step.updated",
          runId,
          step: publishIndex,
          status: "running",
        });

        const contextFile = join(scratchDir, `publish-context-${pi}.json`);
        writeFileSync(
          contextFile,
          JSON.stringify(
            {
              workflow: definition.name,
              status,
              startedAt: startedAt.toISOString(),
              durationMs: Date.now() - startedAt.getTime(),
              steps: executed,
              artefacts: publishedArtefacts,
            },
            null,
            2,
          ),
        );

        const env = buildEnv(publishStep, runId, publishIndex, args.cwd, scratchDir);
        env.KIRI_RUN_CONTEXT_FILE = contextFile;

        const envelope = await runStep({
          step: publishStep,
          cwd: args.cwd,
          scratchDir,
          input: "",
          env,
          onSpawn: (proc) => args.cancelRegistry?.setChild(runId, proc),
        });

        const cancelled = args.cancelRegistry?.isCancelled(runId) ?? false;
        const publishStatus =
          cancelled && envelope.status === "failed" ? "cancelled" : envelope.status;
        const publishError =
          cancelled && envelope.status === "failed" ? CANCELLED_ERROR : (envelope.error ?? null);

        db.update(runSteps)
          .set({
            status: publishStatus,
            output: envelope.output,
            error: publishError,
            traces: envelope.traces,
          })
          .where(eq(runSteps.id, stepId))
          .run();

        args.bus?.publish({
          type: "run.step.updated",
          runId,
          step: publishIndex,
          status: publishStatus,
        });

        if (envelope.status === "ok" && !cancelled) {
          const title = resolvePublishTitle(entry.name, entry.title);
          const contentMd = envelope.output.trimEnd();
          db.insert(runArtefacts)
            .values({
              id: crypto.randomUUID(),
              runId,
              name: entry.name,
              title,
              contentMd,
              createdAt: new Date(),
            })
            .run();
          publishedArtefacts.push({ name: entry.name, title, content_md: contentMd });
        }

        // Cancel mid-publish flips the run terminal status; ordinary
        // failure leaves the run status untouched and lets siblings run.
        if (cancelled && envelope.status === "failed") {
          status = "cancelled";
          runError = { ...CANCELLED_ERROR };
          break;
        }
      }

      // Summariser runs after the steps loop on `ok` and `failed` runs.
      // Cancelled runs skip it: cancel = "stop now", spawning haiku
      // defeats the user's intent. Failure here doesn't change the run's
      // terminal status; the summariser is best-effort.
      if (definition.summarize && status !== "cancelled") {
        const summarizeStep = definition.summarize;
        const summaryIndex = definition.steps.length + publishes.length;
        const contextFile = join(scratchDir, "run-context.json");
        writeFileSync(
          contextFile,
          JSON.stringify(
            {
              workflow: definition.name,
              status,
              startedAt: startedAt.toISOString(),
              durationMs: Date.now() - startedAt.getTime(),
              steps: executed,
              artefacts: publishedArtefacts,
            },
            null,
            2,
          ),
        );

        const materials = captureMaterials(summarizeStep, args.cwd);
        const stepId = crypto.randomUUID();
        db.insert(runSteps)
          .values({
            id: stepId,
            runId,
            index: summaryIndex,
            kind: isUseStep(summarizeStep) ? "use" : "sh",
            status: "running",
            materials,
            isSummary: true,
          })
          .run();

        args.bus?.publish({
          type: "run.step.updated",
          runId,
          step: summaryIndex,
          status: "running",
        });

        const env = buildEnv(summarizeStep, runId, summaryIndex, args.cwd, scratchDir);
        env.KIRI_RUN_CONTEXT_FILE = contextFile;

        const envelope = await runStep({
          step: summarizeStep,
          cwd: args.cwd,
          scratchDir,
          input: "",
          env,
          onSpawn: (proc) => args.cancelRegistry?.setChild(runId, proc),
        });

        const cancelled = args.cancelRegistry?.isCancelled(runId) ?? false;
        const summaryStatus =
          cancelled && envelope.status === "failed" ? "cancelled" : envelope.status;
        const summaryError =
          cancelled && envelope.status === "failed" ? CANCELLED_ERROR : (envelope.error ?? null);

        db.update(runSteps)
          .set({
            status: summaryStatus,
            output: envelope.output,
            error: summaryError,
            traces: envelope.traces,
          })
          .where(eq(runSteps.id, stepId))
          .run();

        args.bus?.publish({
          type: "run.step.updated",
          runId,
          step: summaryIndex,
          status: summaryStatus,
        });

        if (envelope.status === "ok" && !cancelled) {
          const trimmed = envelope.output.trim();
          if (trimmed.length > 0) summaryText = trimmed;
        }

        // Cancel mid-summariser flips the run to cancelled even if the
        // earlier steps completed cleanly: the user pressed cancel, the
        // run is cancelled, summary stays null.
        if (cancelled && envelope.status === "failed") {
          status = "cancelled";
          runError = { ...CANCELLED_ERROR };
        }
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
      .set({ status, finishedAt: new Date(), error: runError ?? null, summary: summaryText })
      .where(eq(runs.id, runId))
      .run();

    // Release after the DB flips terminal so a cancel request arriving in
    // this window observes the run as already-terminal (409) rather than
    // as a registered-but-no-entry inconsistency.
    args.cancelRegistry?.release(runId);

    // run.updated paired with run.finished so consumers that only watch
    // status transitions still see the terminal flip; run.finished carries
    // workflowName so completion toasts can render without a refetch.
    // Published before scratch-dir teardown so a teardown error can't
    // suppress the lifecycle events that downstream views depend on.
    args.bus?.publish({ type: "run.updated", id: runId, status });
    args.bus?.publish({
      type: "run.finished",
      id: runId,
      status,
      workflowName: definition.name,
    });

    rmSync(scratchDir, { recursive: true, force: true });

    if (caughtThrow !== undefined) throw caughtThrow;
    return { runId, status };
  })();

  return { runId, done };
}
