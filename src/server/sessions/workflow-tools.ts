import { type ToolSet, tool } from "ai";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { ConfigStore } from "../config/store.ts";
import type { KiriDb } from "../db/index.ts";
import { articles, runSteps, runs } from "../db/schema.ts";
import type { EventBus } from "../events/index.ts";
import { type LlmClients, summaryStepLabel } from "../llm/index.ts";
import type { CancelRegistry } from "../runner/cancel-registry.ts";
import { runWorkflow } from "../runner/index.ts";
import { type Registry, type WorkflowDefinition, buildInputSchema } from "../workflows/index.ts";

export interface WorkflowToolsDeps {
  db: KiriDb;
  /** Workflow definitions, read live so a file change is reflected on the next call. */
  registry: Registry;
  /** Workspace config forwarded to the runner: bundle paths and per-run scratch dirs resolve against it. */
  config: ConfigStore;
  /** Optional event bus forwarded to the runner, so a session-triggered run publishes the usual `run.*` lifecycle events. */
  bus?: EventBus;
  /** When supplied, runs register for cancellation and an aborted turn cancels the run it started. */
  cancelRegistry?: CancelRegistry;
  /** Completion client for `llm:` steps. Absent ⇒ they fail cleanly. */
  llmClients?: LlmClients;
}

// Label for a row of the tool result: the authored step label for the main
// pipeline (same fallback order as the digest and the run timeline), the
// article slug for `articles:` entries, and "summarize" for the summariser.
// Rows come from the run this tool just executed with this same definition,
// so index alignment is the runner's invariant — lookups here are total.
const phaseLabel = (
  definition: WorkflowDefinition,
  row: { index: number; isArticle: boolean; isSummary: boolean },
): string => {
  if (row.isSummary) return "summarize";
  if (row.isArticle) {
    return `article: ${(definition.articles ?? [])[row.index - definition.steps.length].slug}`;
  }
  return summaryStepLabel(definition.steps[row.index]);
};

// The compact outcome handed back to the model once a run settles: terminal
// status, per-phase statuses with the failing phase's error, the summary,
// and the articles produced. Step output stays on the run page — the result
// reports what happened, it doesn't replay the run into the conversation.
const runOutcome = (db: KiriDb, runId: string, definition: WorkflowDefinition) => {
  // The runner finalises the runs row before `done` resolves, so the row is
  // present; drizzle's `.get()` types it optional regardless.
  const run = db.select().from(runs).where(eq(runs.id, runId)).get() as typeof runs.$inferSelect;
  const stepRows = db
    .select()
    .from(runSteps)
    .where(eq(runSteps.runId, runId))
    .orderBy(asc(runSteps.index))
    .all();
  const articleRows = db
    .select({ slug: articles.slug, name: articles.name })
    .from(articles)
    .where(eq(articles.runId, runId))
    .orderBy(asc(articles.createdAt))
    .all();
  return {
    run_id: runId,
    status: run.status,
    error: (run.error as { message: string } | null)?.message,
    summary: run.summary,
    steps: stepRows.map((row) => ({
      name: phaseLabel(definition, row),
      status: row.status,
      error: (row.error as { message: string } | null)?.message,
    })),
    articles: articleRows,
  };
};

/**
 * First-party tools that let a session list the workspace's workflows and run
 * one — the single sanctioned bridge from the sessions pillar into the
 * workflow pillar. `run_workflow` blocks until the run settles and returns a
 * compact outcome; the run itself is first-class (feed entry, live events,
 * cancellable from the UI), and aborting the turn requests cancellation of
 * the run it started. Expected failures (unknown workflow, invalid inputs)
 * throw with a message naming the call that recovers from them, surfaced to
 * the model as a tool error so it self-corrects mid-turn.
 */
export function workflowTools(deps: WorkflowToolsDeps): ToolSet {
  const { db, registry, config, bus, cancelRegistry, llmClients } = deps;

  return {
    list_workflows: tool({
      description:
        "List the workflows defined in this workspace: each one's name, description, group, and declared inputs (with required flags, defaults, and allowed options). Call it before run_workflow to check the exact workflow name and what inputs it takes.",
      inputSchema: z.object({}),
      execute: async () =>
        registry.listWorkflows().map((def) => ({
          name: def.name,
          description: def.description,
          group: def.group,
          inputs: def.inputs,
        })),
    }),

    run_workflow: tool({
      description:
        "Run one of the workspace's workflows by name and wait for it to finish. Returns the run's terminal status, per-step outcomes, its summary, and the articles it produced (read one with read_article, passing this run's run_id). The run appears in the kiri activity feed with its full step output and traces, so report the outcome briefly rather than replaying it. Every required input must be supplied — call list_workflows first when unsure of the name or inputs.",
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .describe("Name of the workflow to run, exactly as list_workflows reports it."),
        inputs: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            "Values for the workflow's declared inputs, keyed by input name. Required inputs must be present; omit the field entirely for a workflow that declares none.",
          ),
      }),
      execute: async ({ name, inputs }, { abortSignal }) => {
        const definition = registry.getWorkflow(name);
        if (!definition) {
          throw new Error(
            `No workflow named "${name}" — call list_workflows to see what's available.`,
          );
        }
        const check = buildInputSchema(definition).safeParse(inputs ?? {});
        if (!check.success) {
          const issues = check.error.issues.map((issue) => issue.message).join("; ");
          throw new Error(
            `Invalid inputs for workflow "${name}": ${issues} — call list_workflows to see its declared inputs.`,
          );
        }

        const { runId, done } = runWorkflow(db, definition, {
          config,
          bus,
          cancelRegistry,
          inputs,
          llmClients,
        });
        // Cancelling the turn should stop the work it started: an abort maps
        // onto the same cancel path the run-page button uses, and the runner
        // finalises the run as `cancelled` before `done` resolves.
        const onAbort = () => cancelRegistry?.requestCancel(runId);
        abortSignal?.addEventListener("abort", onAbort, { once: true });
        try {
          await done;
        } finally {
          abortSignal?.removeEventListener("abort", onAbort);
        }
        return runOutcome(db, runId, definition);
      },
    }),
  };
}
