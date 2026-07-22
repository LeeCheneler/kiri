import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { resolveArticleName } from "../../shared/article-name.ts";
import type { ConfigStore } from "../config/store.ts";
import type { KiriDb } from "../db/index.ts";
import { articles, recommendations, runSteps, runs } from "../db/schema.ts";
import type { EventBus } from "../events/index.ts";
import { resolveGitHead } from "../git/head.ts";
import type { LlmClients } from "../llm/index.ts";
import {
  type ArticleEntry,
  type LlmConfig,
  type WorkflowDefinition,
  type WorkflowStep,
  isLlmArticle,
  isLlmStep,
  isUseArticle,
  isUseStep,
} from "../workflows/index.ts";
import type { CancelRegistry } from "./cancel-registry.ts";
import { ingestStepOutputs } from "./outputs.ts";
import { ingestStepRecommendations } from "./recommendations.ts";
import { type StepEnvelope, runStep } from "./run-step.ts";
import { writeRunShims } from "./shims.ts";

export interface RunWorkflowArgs {
  /** Workspace config. Bundles resolve via `config.bundleDir()`; the scratch dir lives at `config.runDir(runId)`. */
  config: ConfigStore;
  /** Optional event bus. When supplied, the runner publishes lifecycle events at run/step transitions. */
  bus?: EventBus;
  /** Optional cancel registry. When supplied, the runner registers the run, publishes the active step's child handle for SIGTERM/SIGKILL, checks for cancellation between steps, and translates a cancel-induced step failure into a `cancelled` terminal status. */
  cancelRegistry?: CancelRegistry;
  /** When supplied, reuse this existing `runs` row instead of inserting a new one. The row's `status`, `startedAt`, `definitionSnapshot`, `inputs`, `gitSha`, and `gitDirty` are refreshed, and `finishedAt`/`error`/`summary` are cleared. Used by the in-place rerun path; the caller is responsible for wiping the run's prior state first via `wipeRunForRerun`. */
  runId?: string;
  /** Explicit input values supplied at invocation. Used together with each declared input's `default` to produce the resolved snapshot persisted on `runs.inputs` and consulted when resolving `{ input: <name> }` env references. Ignored when the workflow declares no `inputs:` block. */
  inputs?: Record<string, string>;
  /** Completion client for `llm:` steps. Absent ⇒ they fail cleanly. */
  llmClients?: LlmClients;
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
  summarize?: WorkflowStep;
  articles?: ArticleEntry[];
}

/** A step's kind tag plus the config that identifies it, mirroring the step variants. */
type StepIdent =
  | { kind: "use"; use: string }
  | { kind: "sh"; sh: string }
  | { kind: "llm"; llm: LlmConfig };

const snapshotDefinition = (def: WorkflowDefinition): DefinitionSnapshot => ({
  name: def.name,
  steps: def.steps.map((s) => ({ ...s })),
  summarize: def.summarize ? { ...def.summarize } : undefined,
  articles: def.articles ? def.articles.map((p) => ({ ...p })) : undefined,
});

// Workflows without an `inputs:` block snapshot null — they have nothing
// to record and no env refs can point at an input. Workflows with one
// snapshot only the declared inputs that resolved to a value (supplied
// at invoke or via the input's `default`); validation of required-but-
// missing values is the invoke API's job, not the runner's.
const resolveInputs = (
  def: WorkflowDefinition,
  supplied: Record<string, string> | undefined,
): Record<string, string> | null => {
  if (!def.inputs) return null;
  const resolved: Record<string, string> = {};
  for (const input of def.inputs) {
    const value = supplied?.[input.name] ?? input.default;
    if (value !== undefined) resolved[input.name] = value;
  }
  return resolved;
};

const articleAsStep = (entry: ArticleEntry): WorkflowStep => {
  if (isUseArticle(entry)) return { use: entry.use, env: entry.env };
  if (isLlmArticle(entry)) return { llm: entry.llm, env: entry.env };
  return { sh: entry.sh, env: entry.env };
};

/** The step's kind tag plus identifying config, for `run_steps.kind`. */
const stepIdentOf = (step: WorkflowStep): StepIdent => {
  if (isUseStep(step)) return { kind: "use", use: step.use };
  if (isLlmStep(step)) return { kind: "llm", llm: step.llm };
  return { kind: "sh", sh: step.sh };
};

/**
 * Outputs and articles the run has produced so far, keyed for
 * `{ step: <id> }` / `{ article: <slug> }` env-ref resolution. The schema
 * guarantees refs are backward-only and the fail-fast lifecycle guarantees
 * every ref target completed `ok` before its consumer spawns, so lookups
 * here are total; a miss is an invariant violation, not a user error.
 */
interface RefContext {
  stepOutputs: ReadonlyMap<string, string>;
  /** Per-step named-output maps keyed by step id, for `{ step: <id>, output: <name> }` refs. */
  stepNamedOutputs: ReadonlyMap<string, Record<string, string>>;
  articles: ReadonlyMap<string, string>;
}

// The run's helper shims (`kiri-output`) live inside the scratch dir and
// are PATH-prepended to every step, so they exist exactly as long as the
// run does.
const runBinDir = (config: ConfigStore, runId: string): string =>
  join(config.runDir(runId), ".bin");

const buildEnv = (
  step: WorkflowStep,
  runId: string,
  stepIndex: number,
  config: ConfigStore,
  inputs: Record<string, string> | null,
  refs: RefContext,
): Record<string, string> => {
  // User env is applied first; kiri- and OS-controlled vars overwrite on
  // collision so a workflow can't redirect PATH or shadow KIRI_ identity.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(step.env ?? {})) {
    if (typeof value === "string") {
      env[key] = value;
      continue;
    }
    if ("input" in value) {
      // The schema guarantees every `{ input: <name> }` ref points at a
      // declared input, and run-start snapshots every declared input that
      // resolved to a value (arg-supplied or default). Reaching this branch
      // means a declared input had neither a supplied value nor a default —
      // an invocation-time invariant the invoke API is meant to enforce.
      const resolved = inputs?.[value.input];
      if (resolved === undefined) {
        throw new Error(
          `env "${key}" references input "${value.input}", which is not present on the run snapshot`,
        );
      }
      env[key] = resolved;
      continue;
    }
    if ("step" in value) {
      if (value.output !== undefined) {
        const named = refs.stepNamedOutputs.get(value.step)?.[value.output];
        if (named === undefined) {
          throw new Error(
            `env "${key}" references output "${value.output}" on step "${value.step}", which was not emitted on this run`,
          );
        }
        env[key] = named;
        continue;
      }
      const output = refs.stepOutputs.get(value.step);
      if (output === undefined) {
        throw new Error(
          `env "${key}" references step "${value.step}", which has no output on this run`,
        );
      }
      env[key] = output;
      continue;
    }
    const content = refs.articles.get(value.article);
    if (content === undefined) {
      throw new Error(
        `env "${key}" references article "${value.article}", which has not been produced on this run`,
      );
    }
    env[key] = content;
  }
  env.PATH = `${runBinDir(config, runId)}:${process.env.PATH ?? ""}`;
  env.HOME = process.env.HOME ?? "";
  // USER/LOGNAME are POSIX user-identity vars; tools that authenticate as
  // the user (macOS Keychain lookups, ssh-agent, gpg) rely on them to
  // resolve the active user's session — same category as HOME, not
  // orchestrator state.
  env.USER = process.env.USER ?? "";
  env.LOGNAME = process.env.LOGNAME ?? "";
  env.KIRI_RUN_ID = runId;
  env.KIRI_STEP_INDEX = String(stepIndex);
  env.KIRI_REPO_ROOT = config.cwd();
  // use: steps run with cwd = scratchDir, so the bundle can't reach its
  // own sidecar files via relative paths. KIRI_BUNDLE_DIR points at the
  // bundle source; sh: steps don't have a bundle so it stays unset.
  if (isUseStep(step)) env.KIRI_BUNDLE_DIR = config.bundleDir(step.use);
  return env;
};

/**
 * Clear a settled run's produced state — its `runSteps`, `articles`, and
 * `recommendations` rows plus the scratch dir — so `runWorkflow` can reuse
 * the `runs` row via `args.runId` without accumulating stale rows. Inbound
 * `actionedRunId` references from other runs' recommendations stay intact:
 * the run id persists, so those links still resolve.
 */
export function wipeRunForRerun(db: KiriDb, config: ConfigStore, runId: string): void {
  db.transaction((tx) => {
    tx.delete(articles).where(eq(articles.runId, runId)).run();
    tx.delete(runSteps).where(eq(runSteps.runId, runId)).run();
    tx.delete(recommendations).where(eq(recommendations.runId, runId)).run();
  });
  // Normally already gone via the runner's own cleanup; a crashed runner can
  // leave it behind, and `force: true` makes the common case a no-op.
  rmSync(config.runDir(runId), { recursive: true, force: true });
}

/**
 * Start a workflow run.
 *
 * The `runs` row and `runId` are created synchronously so API callers can
 * navigate to the run detail page immediately and watch live events.
 * Step execution and finalisation continue in the background; await `done`
 * when the caller needs the terminal status (e.g. cron, tests).
 *
 * Lifecycle, in order: insert (or update, when `args.runId` is supplied)
 * `runs` with the definition snapshot, resolved inputs, and data-repo git
 * ref → create the per-run scratch dir → for each step, insert `run_steps`
 * *before* spawning → execute the step → update the row with the envelope
 * → halt on first failure → finalize the `runs` row → remove the scratch
 * dir.
 *
 * Rerun path (`args.runId` supplied): the existing `runs` row is updated
 * back to `"running"` with a fresh `startedAt`/`definitionSnapshot`/
 * `inputs`/git ref, and `finishedAt`/`error`/`summary` are cleared.
 * Trigger is preserved. Callers must wipe the run's prior state first
 * (`wipeRunForRerun`) so the rerun doesn't accumulate stale rows.
 *
 * Halt-on-failure: the run is fail-fast end to end. A failed step leaves
 * later steps uncreated and skips all articles and the summariser; a
 * failed article entry halts remaining articles and the summariser. Either
 * marks the run failed. (A failed summariser is the one exception —
 * best-effort, the run's work already completed.) `done` rejects if any
 * non-envelope surface (mkdir, drizzle) throws — the `runs` row is still
 * finalised to "failed" before the rejection.
 */
export function runWorkflow(
  db: KiriDb,
  definition: WorkflowDefinition,
  args: RunWorkflowArgs,
): StartedRun {
  const runId = args.runId ?? crypto.randomUUID();
  const scratchDir = args.config.runDir(runId);
  const startedAt = new Date();
  const gitHead = resolveGitHead(args.config.cwd());
  const resolvedInputs = resolveInputs(definition, args.inputs);

  if (args.runId === undefined) {
    db.insert(runs)
      .values({
        id: runId,
        workflowName: definition.name,
        status: "running",
        startedAt,
        definitionSnapshot: snapshotDefinition(definition),
        inputs: resolvedInputs,
        gitSha: gitHead.sha,
        gitDirty: gitHead.dirty,
      })
      .run();
  } else {
    db.update(runs)
      .set({
        status: "running",
        startedAt,
        definitionSnapshot: snapshotDefinition(definition),
        inputs: resolvedInputs,
        gitSha: gitHead.sha,
        gitDirty: gitHead.dirty,
        finishedAt: null,
        error: null,
        summary: null,
      })
      .where(eq(runs.id, runId))
      .run();
  }

  // Register synchronously so a cancel request received between this
  // function returning and the executor's first await never sees a
  // running DB row that the registry doesn't know about.
  args.cancelRegistry?.register(runId);
  args.bus?.publish({ type: "run.started", id: runId });

  // Populated as the run progresses: an ok step that declared an `id` lands
  // its stdout (and, when it declared `outputs:`, its named-output map)
  // here, and each stored article lands under its slug. Read by buildEnv
  // when resolving `{ step: <id> }` / `{ step, output }` /
  // `{ article: <slug> }` refs.
  const stepOutputsById = new Map<string, string>();
  const stepNamedOutputsById = new Map<string, Record<string, string>>();
  const articlesBySlug = new Map<string, string>();

  // Insert → publish "running" → spawn → translate envelope → update →
  // publish terminal. Every phase (steps, articles, summarise) reimplements
  // this same envelope; the helper captures it so each phase only expresses
  // its own pre/post policy.
  const executePhase = async (opts: {
    step: WorkflowStep;
    index: number;
    flag?: "article" | "summary";
    envExtras?: Record<string, string>;
    /** The step's named-outputs channel, present only when it declares `outputs:`. An ok envelope missing a declared name flips the step to failed. */
    outputsChannel?: { file: string; declared: readonly string[] };
  }): Promise<{
    envelope: StepEnvelope;
    cancelled: boolean;
    stepStatus: "ok" | "failed" | "cancelled";
    stepError: { message: string; stack?: string } | null;
    /** The ingested named-output map when the step declared `outputs:` and settled ok; null otherwise. */
    outputs: Record<string, string> | null;
  }> => {
    const stepId = crypto.randomUUID();
    db.insert(runSteps)
      .values({
        id: stepId,
        runId,
        index: opts.index,
        kind: stepIdentOf(opts.step).kind,
        status: "running",
        startedAt: new Date(),
        isArticle: opts.flag === "article" ? true : undefined,
        isSummary: opts.flag === "summary" ? true : undefined,
      })
      .run();

    args.bus?.publish({ type: "run.step.updated", runId, step: opts.index, status: "running" });

    const env = buildEnv(opts.step, runId, opts.index, args.config, resolvedInputs, {
      stepOutputs: stepOutputsById,
      stepNamedOutputs: stepNamedOutputsById,
      articles: articlesBySlug,
    });
    if (opts.envExtras) Object.assign(env, opts.envExtras);

    const envelope = await runStep({
      step: opts.step,
      config: args.config,
      scratchDir,
      env,
      llmClients: args.llmClients,
      onSpawn: (proc) => args.cancelRegistry?.setChild(runId, proc),
    });

    // An ok envelope only settles as ok once the outputs contract holds:
    // every declared name must have been emitted. A miss fails the step —
    // the producer broke its promise, and failing here (rather than at a
    // consumer's ref) blames the right party.
    let outputs: Record<string, string> | null = null;
    let outputsError: { message: string } | null = null;
    if (opts.outputsChannel && envelope.status === "ok") {
      const ingested = ingestStepOutputs(
        runId,
        opts.outputsChannel.file,
        opts.outputsChannel.declared,
      );
      if (ingested.missing.length > 0) {
        outputsError = {
          message: `step declared outputs it did not emit: ${ingested.missing.join(", ")} — emit each with \`kiri-output <name> <value>\``,
        };
      } else {
        outputs = ingested.outputs;
      }
    }

    // A `failed` envelope produced after cancel was requested is the child
    // reacting to our SIGTERM/SIGKILL — surface it as `cancelled` on the
    // step row so the UI distinguishes "we stopped this" from "the script
    // broke". An `ok` envelope is left as-is even if cancel was requested
    // mid-execution: the step actually finished — which is also why an
    // outputs-contract failure stays `failed` under cancel: the child
    // wasn't interrupted, it completed without emitting what it declared.
    const cancelled = args.cancelRegistry?.isCancelled(runId) ?? false;
    const stepStatus: "ok" | "failed" | "cancelled" =
      cancelled && envelope.status === "failed"
        ? "cancelled"
        : outputsError !== null
          ? "failed"
          : envelope.status;
    const stepError =
      cancelled && envelope.status === "failed"
        ? CANCELLED_ERROR
        : (envelope.error ?? outputsError ?? null);

    db.update(runSteps)
      .set({
        status: stepStatus,
        finishedAt: new Date(),
        output: envelope.output,
        outputs,
        error: stepError,
        traces: envelope.traces,
      })
      .where(eq(runSteps.id, stepId))
      .run();

    args.bus?.publish({ type: "run.step.updated", runId, step: opts.index, status: stepStatus });

    return { envelope, cancelled, stepStatus, stepError, outputs };
  };

  const done = (async (): Promise<RunWorkflowResult> => {
    let status: "ok" | "failed" | "cancelled" = "ok";
    let runError: { message: string; stack?: string } | undefined;
    let caughtThrow: unknown;
    let summaryText: string | null = null;

    try {
      mkdirSync(scratchDir, { recursive: true });
      writeRunShims(runBinDir(args.config, runId));
      // Cross-step counter so the order steps emitted in is preserved
      // by `recommendations.index` regardless of how many lines each
      // step contributed.
      let recommendationIndex = 0;
      for (let i = 0; i < definition.steps.length; i++) {
        if (args.cancelRegistry?.isCancelled(runId)) break;

        const step = definition.steps[i];
        const recommendationsFile = join(scratchDir, `recommendations-${i}.jsonl`);
        const outputsFile = join(scratchDir, `outputs-${i}.jsonl`);
        // A completion can't write files, so llm steps get neither file
        // channel; the outputs channel additionally requires the step to
        // declare `outputs:` — kiri-output fails loudly without it.
        const declaredOutputs = isLlmStep(step) ? undefined : step.outputs;
        const { envelope, cancelled, stepStatus, stepError, outputs } = await executePhase({
          step,
          index: i,
          envExtras: isLlmStep(step)
            ? undefined
            : {
                KIRI_RECOMMENDATIONS_FILE: recommendationsFile,
                ...(declaredOutputs ? { KIRI_OUTPUTS_FILE: outputsFile } : {}),
              },
          outputsChannel: declaredOutputs
            ? { file: outputsFile, declared: declaredOutputs }
            : undefined,
        });

        if (stepStatus === "ok") {
          recommendationIndex = ingestStepRecommendations(
            db,
            runId,
            recommendationsFile,
            recommendationIndex,
          );
        }

        // Halt on the step's settled status, not the raw envelope: an ok
        // envelope that broke its outputs contract has already been marked
        // failed on the row and must halt the pipeline the same way.
        if (stepStatus !== "ok") {
          status = stepStatus === "cancelled" ? "cancelled" : "failed";
          runError = stepStatus === "cancelled" ? { ...CANCELLED_ERROR } : (stepError ?? undefined);
          break;
        }
        if (cancelled) break;
        if (step.id !== undefined) {
          stepOutputsById.set(step.id, envelope.output);
          if (outputs !== null) stepNamedOutputsById.set(step.id, outputs);
        }
      }

      // Loop ended without a step failure but cancel was requested — either
      // before the first iteration or in the gap after a step's `ok`. The
      // run is cancelled even though no step row was marked so.
      if (status === "ok" && args.cancelRegistry?.isCancelled(runId)) {
        status = "cancelled";
        runError = { ...CANCELLED_ERROR };
      }

      // Articles only run while the run is still `ok`. A failed or
      // cancelled pipeline skips them: articles describe a successful
      // run, and emitting them off the back of a broken pipeline produces
      // misleading output. The run is fail-fast throughout — a failing
      // article entry flips the run to `failed` and halts remaining
      // articles and the summariser, the same way a failing step halts
      // the pipeline. Cancel mid-article flips it to `cancelled` and halts.
      const articleEntries = definition.articles ?? [];
      for (let pi = 0; pi < articleEntries.length && status === "ok"; pi++) {
        if (args.cancelRegistry?.isCancelled(runId)) {
          status = "cancelled";
          runError = { ...CANCELLED_ERROR };
          break;
        }

        const entry = articleEntries[pi];
        const articleStep = articleAsStep(entry);
        const articleIndex = definition.steps.length + pi;

        // Articles get no auto-injected data: exactly what the entry
        // declared through { step: <id> } / { article: <slug> } env refs.
        const { envelope, cancelled } = await executePhase({
          step: articleStep,
          index: articleIndex,
          flag: "article",
        });

        if (envelope.status === "ok" && !cancelled) {
          const name = resolveArticleName(entry.slug, entry.name);
          const contentMd = envelope.output.trimEnd();
          db.insert(articles)
            .values({
              id: crypto.randomUUID(),
              runId,
              slug: entry.slug,
              name,
              contentMd,
              createdAt: new Date(),
            })
            .run();
          articlesBySlug.set(entry.slug, contentMd);
        }

        if (cancelled && envelope.status === "failed") {
          status = "cancelled";
          runError = { ...CANCELLED_ERROR };
          break;
        }
        if (envelope.status === "failed") {
          status = "failed";
          runError = envelope.error;
          break;
        }
      }

      // Summariser only runs when the run is still `ok`. A failed steps
      // pipeline or a failed article entry skips it: there's nothing to celebrate
      // and running haiku to describe a broken run wastes a model call.
      // Failure here doesn't change the run's terminal status; the
      // summariser is best-effort.
      if (definition.summarize && status === "ok") {
        const summaryIndex = definition.steps.length + articleEntries.length;
        // Like every other phase, the summariser receives exactly the data
        // its env: declares — { step: <id> } / { step, output } /
        // { article: <slug> } refs resolved at spawn.
        const { envelope, cancelled } = await executePhase({
          step: definition.summarize,
          index: summaryIndex,
          flag: "summary",
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
    // status transitions still see the terminal flip. Published before
    // scratch-dir teardown so a teardown error can't suppress the lifecycle
    // events that downstream views depend on.
    args.bus?.publish({ type: "run.updated", id: runId, status });
    args.bus?.publish({ type: "run.finished", id: runId, status });

    rmSync(scratchDir, { recursive: true, force: true });

    if (caughtThrow !== undefined) throw caughtThrow;
    return { runId, status };
  })();

  return { runId, done };
}
