import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { resolvePublishName } from "../../shared/publish-name.ts";
import type { ConfigStore } from "../config/store.ts";
import type { KiriDb } from "../db/index.ts";
import { articles, runSteps, runs } from "../db/schema.ts";
import type { EventBus } from "../events/index.ts";
import { resolveGitHead } from "../git/head.ts";
import {
  DEFAULT_SUMMARY_PROMPT,
  type LlmClients,
  type RunContextArticle,
  type RunContextStep,
  buildRunContext,
  buildSummaryContext,
} from "../llm/index.ts";
import {
  type LlmConfig,
  type PublishEntry,
  type WorkflowDefinition,
  type WorkflowStep,
  isLlmPublish,
  isLlmStep,
  isUsePublish,
  isUseStep,
} from "../workflows/index.ts";
import type { CancelRegistry } from "./cancel-registry.ts";
import { ingestStepRecommendations } from "./recommendations.ts";
import { type StepEnvelope, runStep } from "./run-step.ts";

export interface RunWorkflowArgs {
  /** Workspace config. Bundles resolve via `config.bundleDir()`; the scratch dir lives at `config.runDir(runId)`. */
  config: ConfigStore;
  /** Optional event bus. When supplied, the runner publishes lifecycle events at run/step transitions. */
  bus?: EventBus;
  /** Optional cancel registry. When supplied, the runner registers the run, publishes the active step's child handle for SIGTERM/SIGKILL, checks for cancellation between steps, and translates a cancel-induced step failure into a `cancelled` terminal status. */
  cancelRegistry?: CancelRegistry;
  /** When supplied, reuse this existing `runs` row instead of inserting a new one. The row's `status`, `startedAt`, `definitionSnapshot`, `inputs`, `gitSha`, and `gitDirty` are refreshed, and `finishedAt`/`error`/`summary` are cleared. Used by the in-place rerun path; the caller is responsible for wiping prior `runSteps` / `articles` and the scratch dir first. */
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
  publish?: PublishEntry[];
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
  publish: def.publish ? def.publish.map((p) => ({ ...p })) : undefined,
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

const publishAsStep = (entry: PublishEntry): WorkflowStep => {
  if (isUsePublish(entry)) return { use: entry.use, env: entry.env };
  if (isLlmPublish(entry)) return { llm: entry.llm, env: entry.env };
  return { sh: entry.sh, env: entry.env };
};

// The schema lets a summarize llm step omit both prompt fields so
// `summarize: { llm: { model } }` works zero-config; the baked-in prompt
// reads the inlined {{KIRI_RUN_CONTEXT}} envelope. The substitution stays
// out of the definition snapshot — that records what was authored.
const withDefaultSummaryPrompt = (step: WorkflowStep): WorkflowStep =>
  isLlmStep(step) && step.llm.prompt === undefined && step.llm.prompt_file === undefined
    ? { ...step, llm: { ...step.llm, prompt: DEFAULT_SUMMARY_PROMPT } }
    : step;

/** The step's kind tag plus identifying config, for `run_steps.kind` and the run-context file. */
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
  articles: ReadonlyMap<string, string>;
}

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
        `env "${key}" references article "${value.article}", which has not been published on this run`,
      );
    }
    env[key] = content;
  }
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
  env.KIRI_REPO_ROOT = config.cwd();
  // use: steps run with cwd = scratchDir, so the bundle can't reach its
  // own sidecar files via relative paths. KIRI_BUNDLE_DIR points at the
  // bundle source; sh: steps don't have a bundle so it stays unset.
  if (isUseStep(step)) env.KIRI_BUNDLE_DIR = config.bundleDir(step.use);
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
 * Trigger is preserved. Callers must wipe prior `runSteps` / `articles`
 * and the scratch dir before invoking so the rerun doesn't accumulate
 * stale rows.
 *
 * Halt-on-failure: the run is fail-fast end to end. A failed step leaves
 * later steps uncreated and skips all publishes and the summariser; a
 * failed publish halts remaining publishes and the summariser. Either
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
  // its stdout here, and each stored article lands under its slug. Read by
  // buildEnv when resolving `{ step: <id> }` / `{ article: <slug> }` refs.
  const stepOutputsById = new Map<string, string>();
  const articlesBySlug = new Map<string, string>();

  // Insert → publish "running" → spawn → translate envelope → update →
  // publish terminal. Every phase (steps, publish, summarise) reimplements
  // this same envelope; the helper captures it so each phase only expresses
  // its own pre/post policy.
  const executePhase = async (opts: {
    step: WorkflowStep;
    index: number;
    flag?: "publish" | "summary";
    input: string;
    envExtras?: Record<string, string>;
  }): Promise<{
    envelope: StepEnvelope;
    cancelled: boolean;
    stepStatus: "ok" | "failed" | "cancelled";
    stepError: { message: string; stack?: string } | null;
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
        isPublish: opts.flag === "publish" ? true : undefined,
        isSummary: opts.flag === "summary" ? true : undefined,
      })
      .run();

    args.bus?.publish({ type: "run.step.updated", runId, step: opts.index, status: "running" });

    const env = buildEnv(opts.step, runId, opts.index, args.config, resolvedInputs, {
      stepOutputs: stepOutputsById,
      articles: articlesBySlug,
    });
    if (opts.envExtras) Object.assign(env, opts.envExtras);

    const envelope = await runStep({
      step: opts.step,
      config: args.config,
      scratchDir,
      input: opts.input,
      env,
      llmClients: args.llmClients,
      onSpawn: (proc) => args.cancelRegistry?.setChild(runId, proc),
    });

    // A `failed` envelope produced after cancel was requested is the child
    // reacting to our SIGTERM/SIGKILL — surface it as `cancelled` on the
    // step row so the UI distinguishes "we stopped this" from "the script
    // broke". An `ok` envelope is left as-is even if cancel was requested
    // mid-execution: the step actually finished.
    const cancelled = args.cancelRegistry?.isCancelled(runId) ?? false;
    const stepStatus: "ok" | "failed" | "cancelled" =
      cancelled && envelope.status === "failed" ? "cancelled" : envelope.status;
    const stepError =
      cancelled && envelope.status === "failed" ? CANCELLED_ERROR : (envelope.error ?? null);

    db.update(runSteps)
      .set({
        status: stepStatus,
        finishedAt: new Date(),
        output: envelope.output,
        error: stepError,
        traces: envelope.traces,
      })
      .where(eq(runSteps.id, stepId))
      .run();

    args.bus?.publish({ type: "run.step.updated", runId, step: opts.index, status: stepStatus });

    return { envelope, cancelled, stepStatus, stepError };
  };

  const done = (async (): Promise<RunWorkflowResult> => {
    let status: "ok" | "failed" | "cancelled" = "ok";
    let runError: { message: string; stack?: string } | undefined;
    let caughtThrow: unknown;
    let summaryText: string | null = null;
    // Accumulated step outcomes and articles, serialised into the run
    // context handed to publish/summarize phases so they have the full
    // run picture without a DB round-trip.
    const executed: RunContextStep[] = [];
    const publishedArticles: RunContextArticle[] = [];

    try {
      mkdirSync(scratchDir, { recursive: true });
      let input = "";
      // Cross-step counter so the order steps emitted in is preserved
      // by `recommendations.index` regardless of how many lines each
      // step contributed.
      let recommendationIndex = 0;
      for (let i = 0; i < definition.steps.length; i++) {
        if (args.cancelRegistry?.isCancelled(runId)) break;

        const step = definition.steps[i];
        const recommendationsFile = join(scratchDir, `recommendations-${i}.jsonl`);
        const { envelope, cancelled, stepStatus, stepError } = await executePhase({
          step,
          index: i,
          input,
          // A completion can't write files, so llm steps aren't offered the
          // recommendations channel; ingestion below no-ops on the absent file.
          envExtras: isLlmStep(step)
            ? undefined
            : { KIRI_RECOMMENDATIONS_FILE: recommendationsFile },
        });

        if (stepStatus === "ok") {
          recommendationIndex = ingestStepRecommendations(
            db,
            runId,
            recommendationsFile,
            recommendationIndex,
          );
        }

        executed.push({
          ...stepIdentOf(step),
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
        if (step.id !== undefined) stepOutputsById.set(step.id, envelope.output);
        input = envelope.output;
      }

      // Loop ended without a step failure but cancel was requested — either
      // before the first iteration or in the gap after a step's `ok`. The
      // run is cancelled even though no step row was marked so.
      if (status === "ok" && args.cancelRegistry?.isCancelled(runId)) {
        status = "cancelled";
        runError = { ...CANCELLED_ERROR };
      }

      // Publishes only run while the run is still `ok`. A failed or
      // cancelled pipeline skips them: articles describe a successful
      // run, and emitting them off the back of a broken pipeline produces
      // misleading output. The run is fail-fast throughout — a failing
      // publish flips the run to `failed` and halts remaining publishes
      // and the summariser, the same way a failing step halts the
      // pipeline. Cancel mid-publish flips it to `cancelled` and halts.
      const publishes = definition.publish ?? [];
      for (let pi = 0; pi < publishes.length && status === "ok"; pi++) {
        if (args.cancelRegistry?.isCancelled(runId)) {
          status = "cancelled";
          runError = { ...CANCELLED_ERROR };
          break;
        }

        const entry = publishes[pi];
        const publishStep = publishAsStep(entry);
        const publishIndex = definition.steps.length + pi;

        const contextJson = buildRunContext({
          workflow: definition.name,
          status,
          startedAt: startedAt.toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          steps: executed,
          articles: publishedArticles,
        });
        let envExtras: Record<string, string>;
        if (isLlmStep(publishStep)) {
          // A completion can't read files; the envelope is inlined for the
          // prompt's {{KIRI_RUN_CONTEXT}} and no context file is written.
          envExtras = { KIRI_RUN_CONTEXT: contextJson };
        } else {
          const contextFile = join(scratchDir, `publish-context-${pi}.json`);
          writeFileSync(contextFile, contextJson);
          envExtras = { KIRI_RUN_CONTEXT_FILE: contextFile };
        }

        const { envelope, cancelled } = await executePhase({
          step: publishStep,
          index: publishIndex,
          flag: "publish",
          input: "",
          envExtras,
        });

        if (envelope.status === "ok" && !cancelled) {
          const name = resolvePublishName(entry.slug, entry.name);
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
          publishedArticles.push({ slug: entry.slug, name, content_md: contentMd });
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
      // pipeline or a failed publish skips it: there's nothing to celebrate
      // and running haiku to describe a broken run wastes a model call.
      // Failure here doesn't change the run's terminal status; the
      // summariser is best-effort.
      if (definition.summarize && status === "ok") {
        const summarizeStep = withDefaultSummaryPrompt(definition.summarize);
        const summaryIndex = definition.steps.length + publishes.length;
        const contextJson = buildRunContext({
          workflow: definition.name,
          status,
          startedAt: startedAt.toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          steps: executed,
          articles: publishedArticles,
        });
        // The gist plane: a prompt-ready plain-text digest of the run,
        // injected the same way for every summarize shape — `sh:`/`use:`
        // read $KIRI_SUMMARY_CONTEXT, `llm:` prompts template
        // {{KIRI_SUMMARY_CONTEXT}}. Summarize runs only on fully-ok
        // pipelines, so `executed` covers every authored step.
        const summaryContext = buildSummaryContext({
          workflow: definition.name,
          durationMs: Date.now() - startedAt.getTime(),
          steps: executed.map((executedStep) => ({
            step: definition.steps[executedStep.index],
            index: executedStep.index,
            durationMs: executedStep.durationMs,
            stdout: executedStep.stdout,
          })),
          articles: publishedArticles,
        });
        let envExtras: Record<string, string>;
        if (isLlmStep(summarizeStep)) {
          // A completion can't read files; the envelope is inlined for the
          // prompt's {{KIRI_RUN_CONTEXT}} and no context file is written.
          envExtras = { KIRI_RUN_CONTEXT: contextJson, KIRI_SUMMARY_CONTEXT: summaryContext };
        } else {
          const contextFile = join(scratchDir, "run-context.json");
          writeFileSync(contextFile, contextJson);
          envExtras = {
            KIRI_RUN_CONTEXT_FILE: contextFile,
            KIRI_SUMMARY_CONTEXT: summaryContext,
          };
        }

        const { envelope, cancelled } = await executePhase({
          step: summarizeStep,
          index: summaryIndex,
          flag: "summary",
          input: "",
          envExtras,
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
