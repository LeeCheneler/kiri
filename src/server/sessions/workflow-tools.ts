import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { type ToolSet, tool } from "ai";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { ConfigStore } from "../config/store.ts";
import type { KiriDb } from "../db/index.ts";
import { articles, runSteps, runs } from "../db/schema.ts";
import type { EventBus } from "../events/index.ts";
import { type LlmClients, summaryStepLabel } from "../llm/index.ts";
import type { CancelRegistry } from "../runner/cancel-registry.ts";
import { runWorkflow, wipeRunForRerun } from "../runner/index.ts";
import {
  type Registry,
  type WorkflowDefinition,
  buildInputSchema,
  parseWorkflowSource,
} from "../workflows/index.ts";
import { WORKFLOW_AUTHORING_GUIDE } from "./workflow-authoring-guide.ts";

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
  /**
   * Live provider names for the authoring tools' validation gate, so an
   * authored `llm:` step checks its provider prefix the same way the loader
   * does. Absent ⇒ every `llm:` workflow is rejected as unknown-provider,
   * matching a workspace with no providers configured.
   */
  getProviderNames?: () => ReadonlySet<string>;
}

// Filename grammar for created workflows — the `<slug>` of
// `workflows/<slug>.yaml`. Same shape as article slugs: no dots or path
// separators, so a crafted slug cannot escape the workflows directory.
const workflowFileSlugSchema = z.string().regex(/^[a-z0-9-]+$/, {
  message: "workflow file slug must match ^[a-z0-9-]+$",
});

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

// Per-stream cap on the failure output attached to a failed phase in the
// run outcome. The tail is kept — a failing process prints its cause last —
// and the marker points at the run page, which holds the full streams.
const FAILURE_STREAM_CAP = 8 * 1024;

const failureStreamTail = (value: string): string | undefined => {
  if (value === "") return undefined;
  if (value.length <= FAILURE_STREAM_CAP) return value;
  let tail = value.slice(-FAILURE_STREAM_CAP);
  // slice() cuts at a UTF-16 code-unit index, so a character encoded as a
  // surrogate pair (emoji etc.) can be split in half at the cap. A kept
  // tail starting with a low surrogate (0xdc00–0xdfff) carries an orphan
  // half — drop it so the output stays well-formed Unicode.
  const first = tail.charCodeAt(0);
  if (first >= 0xdc00 && first <= 0xdfff) tail = tail.slice(1);
  return `[truncated — full output on the run page]\n${tail}`;
};

// The compact outcome handed back to the model once a run settles: terminal
// status, per-phase statuses with the failing phase's error, the summary,
// and the articles produced. Success output stays on the run page — the
// result reports what happened, it doesn't replay the run into the
// conversation. A failed phase is the exception: the tails of its captured
// stdout/stderr ride along, since its error message alone (often just the
// exit code) gives the model nothing to diagnose the failure with.
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
    steps: stepRows.map((row) => {
      // The runner stamps traces on every finalised row, so a failed row
      // always carries them; the cast is total for the rows read here.
      const traces =
        row.status === "failed" ? (row.traces as { stdout: string; stderr: string }) : null;
      return {
        name: phaseLabel(definition, row),
        status: row.status,
        error: (row.error as { message: string } | null)?.message,
        stdout: traces === null ? undefined : failureStreamTail(traces.stdout),
        stderr: traces === null ? undefined : failureStreamTail(traces.stderr),
      };
    }),
    articles: articleRows,
  };
};

/**
 * First-party tools bridging a session into the workflow pillar: listing the
 * workspace's workflows, running one — fresh, or re-executing an existing run
 * in place — and authoring them: reading, creating, editing, and replacing
 * the YAML files in `workflows/`. Every write runs the loader's own
 * validation gate first, so nothing invalid ever reaches disk, and lands in
 * the watched directory, so the catalog picks it up without a restart.
 * `run_workflow` and `rerun_workflow` block until the run settles and return
 * a compact outcome; the run itself is first-class (feed entry, live events,
 * cancellable from the UI), and aborting the turn requests cancellation of
 * the run it started. Expected failures (unknown workflow or run, invalid
 * inputs or YAML, duplicate names, ambiguous edits) throw with a message
 * naming the call that recovers from them, surfaced to the model as a tool
 * error so it self-corrects mid-turn.
 */
export function workflowTools(deps: WorkflowToolsDeps): ToolSet {
  const { db, registry, config, bus, cancelRegistry, llmClients, getProviderNames } = deps;

  // The loader's per-file validation, applied to a source about to be
  // written: an invalid source throws the gate's reason so the write never
  // happens and the model can fix the YAML and retry.
  const validateSource = (contentYaml: string): WorkflowDefinition => {
    const result = parseWorkflowSource(contentYaml, config, getProviderNames?.() ?? new Set());
    if (!result.ok) {
      throw new Error(`Invalid workflow YAML — nothing was written. ${result.reason}`);
    }
    return result.workflow;
  };

  const requireSource = (name: string): string => {
    const source = registry.getSource(name);
    if (source === undefined) {
      throw new Error(`No workflow named "${name}" — call list_workflows to see what's available.`);
    }
    return source;
  };

  // A rewrite may rename the workflow (the name lives in the YAML). A rename
  // colliding with another workflow would only surface as a load failure
  // after the write, so reject it before it reaches disk.
  const requireRenameFree = (nextName: string, currentName: string): void => {
    if (nextName !== currentName && registry.getWorkflow(nextName)) {
      throw new Error(
        `A workflow named "${nextName}" already exists — keep the name "${currentName}" or pick an unused one.`,
      );
    }
  };

  const workspaceRelative = (path: string): string => relative(config.cwd(), path);

  // Written files end with a newline regardless of what the model sent, so
  // the file is POSIX-clean and a later targeted edit sees stable content.
  const withTrailingNewline = (content: string): string =>
    content.endsWith("\n") ? content : `${content}\n`;

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
        "Run one of the workspace's workflows by name and wait for it to finish. Returns the run's terminal status, per-step outcomes, its summary, and the articles it produced (read one with read_article, passing this run's run_id). A failed step's entry includes the tail of its captured stdout and stderr, so diagnose a failure from the result. The run appears in the kiri activity feed with its full step output and traces, so report the outcome briefly rather than replaying it. Every required input must be supplied — call list_workflows first when unsure of the name or inputs. Start each workflow at most once per conversation this way: to execute it again — retrying, or testing an edit — use rerun_workflow with this run's run_id instead of piling a second run into the feed.",
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

    rerun_workflow: tool({
      description:
        "Re-execute a finished run of one of the workspace's workflows and wait for it to finish, replacing that run's previous results under the same run_id and activity-feed entry. Reach for it instead of run_workflow whenever you are repeating a run you already started — above all when test-running edits to a workflow you are authoring — so iterating doesn't stack near-identical runs in the user's feed. The workflow's current definition is what runs, so edits made since the last run apply. Inputs follow run_workflow's contract and are not carried over from the previous run — re-supply every required input. Returns the same outcome shape as run_workflow.",
      inputSchema: z.object({
        run_id: z
          .string()
          .min(1)
          .describe(
            "Id of the run to re-execute, as reported by an earlier run_workflow or rerun_workflow outcome.",
          ),
        inputs: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            "Values for the workflow's declared inputs, keyed by input name. Required inputs must be present — the previous run's values are not reused; omit the field entirely for a workflow that declares none.",
          ),
      }),
      execute: async ({ run_id, inputs }, { abortSignal }) => {
        const run = db.select().from(runs).where(eq(runs.id, run_id)).get();
        if (!run) {
          throw new Error(
            `No run with id "${run_id}" — pass the run_id from an earlier run_workflow outcome, or start a fresh run with run_workflow.`,
          );
        }
        if (run.status === "running") {
          throw new Error(
            `Run "${run_id}" is still in flight — wait for it to settle before rerunning it.`,
          );
        }
        const definition = registry.getWorkflow(run.workflowName);
        if (!definition) {
          throw new Error(
            `Workflow "${run.workflowName}" no longer exists — if it was renamed, start a fresh run with run_workflow.`,
          );
        }
        const check = buildInputSchema(definition).safeParse(inputs ?? {});
        if (!check.success) {
          const issues = check.error.issues.map((issue) => issue.message).join("; ");
          throw new Error(
            `Invalid inputs for workflow "${run.workflowName}": ${issues} — call list_workflows to see its declared inputs.`,
          );
        }

        wipeRunForRerun(db, config, run_id);
        const { done } = runWorkflow(db, definition, {
          config,
          bus,
          cancelRegistry,
          runId: run_id,
          inputs,
          llmClients,
        });
        // Same abort mapping as run_workflow: cancelling the turn cancels
        // the rerun it started.
        const onAbort = () => cancelRegistry?.requestCancel(run_id);
        abortSignal?.addEventListener("abort", onAbort, { once: true });
        try {
          await done;
        } finally {
          abortSignal?.removeEventListener("abort", onAbort);
        }
        return runOutcome(db, run_id, definition);
      },
    }),

    read_workflow_authoring_guide: tool({
      description:
        "Return kiri's complete workflow-authoring reference: the YAML file shape, the three step kinds, data-flow and env rules, articles and summarize, inputs, and the working method for authoring well. Call it once per conversation before your first create_workflow, edit_workflow, or replace_workflow call — its content is authoritative and more detailed than any tool description. Don't call it again once its content is in the conversation.",
      inputSchema: z.object({}),
      execute: async () => WORKFLOW_AUTHORING_GUIDE,
    }),

    read_workflow: tool({
      description:
        "Read the raw YAML of one of this workspace's workflows, exactly as the file is on disk. Call it to learn the workspace's workflow shape and house style before authoring a new one, and always before edit_workflow so old_string matches the exact current text.",
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .describe("Name of the workflow to read, exactly as list_workflows reports it."),
      }),
      execute: async ({ name }) => {
        const source = requireSource(name);
        return {
          name,
          file: workspaceRelative(source),
          content_yaml: readFileSync(source, "utf8"),
        };
      },
    }),

    create_workflow: tool({
      description:
        "Create a new workflow in this workspace: a repeatable automation saved as a YAML file in workflows/, which kiri runs on demand. Use it when the user wants to keep, automate, or repeat something — including turning work figured out in this conversation into a workflow they can run any time. Before your first authoring call in a conversation, call read_workflow_authoring_guide and follow it — it is the authoritative reference for the YAML shape and rules. Supply the complete YAML file content; it is validated before anything is written, and a rejected call names exactly what to fix (YAML parse error, schema violation, unknown bundle or llm provider, missing prompt file) — correct the YAML and retry. The workflow appears in the catalog immediately and can be run with run_workflow.",
      inputSchema: z.object({
        slug: workflowFileSlugSchema.describe(
          'Filename for the new workflow — lowercase letters, digits, and hyphens (e.g. "pr-digest"). The file is written to workflows/<slug>.yaml.',
        ),
        content_yaml: z
          .string()
          .min(1)
          .describe(
            "The complete YAML file content — `name`, optional `description`/`group`/`inputs`, required `steps`, optional `articles` and `summarize`. The full shape and rules are in read_workflow_authoring_guide.",
          ),
      }),
      execute: async ({ slug, content_yaml }) => {
        const definition = validateSource(content_yaml);
        if (registry.getWorkflow(definition.name)) {
          throw new Error(
            `A workflow named "${definition.name}" already exists — use edit_workflow for a targeted change, replace_workflow to rewrite it, or pick a different name.`,
          );
        }
        for (const filename of [`${slug}.yaml`, `${slug}.yml`]) {
          if (existsSync(join(config.workflowsDir(), filename))) {
            throw new Error(`workflows/${filename} already exists — pick a different slug.`);
          }
        }
        const path = join(config.workflowsDir(), `${slug}.yaml`);
        writeFileSync(path, withTrailingNewline(content_yaml));
        return { name: definition.name, file: workspaceRelative(path) };
      },
    }),

    edit_workflow: tool({
      description:
        "Make a targeted edit to one of this workspace's workflows by replacing an exact string in its YAML file. old_string must match the file exactly — including indentation and whitespace — and appear exactly once unless replace_all is set; get the exact current text with read_workflow. Before your first authoring call in a conversation, call read_workflow_authoring_guide and follow it. The edited file is re-validated in full before it is written — an invalid result is rejected with the reason and the file on disk is unchanged, so fix and retry. For a wholesale rewrite use replace_workflow.",
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .describe("Name of the workflow to edit, exactly as list_workflows reports it."),
        old_string: z.string().min(1).describe("Exact text currently in the YAML file to replace."),
        new_string: z.string().describe("Replacement text. May be empty to delete old_string."),
        replace_all: z
          .boolean()
          .optional()
          .describe(
            "Replace every occurrence of old_string instead of requiring it to be unique. Defaults to false.",
          ),
      }),
      execute: async ({ name, old_string, new_string, replace_all }) => {
        if (old_string === new_string) {
          throw new Error("old_string and new_string are identical — nothing to change.");
        }
        const source = requireSource(name);
        const raw = readFileSync(source, "utf8");
        const count = raw.split(old_string).length - 1;
        if (count === 0) {
          throw new Error(
            `old_string was not found in workflow "${name}" — call read_workflow and retry with the exact current text.`,
          );
        }
        if (count > 1 && replace_all !== true) {
          throw new Error(
            `old_string appears ${count} times in workflow "${name}" — include more surrounding context to pin down one occurrence, or set replace_all to change every one.`,
          );
        }
        const next = raw.replaceAll(old_string, new_string);
        const definition = validateSource(next);
        requireRenameFree(definition.name, name);
        writeFileSync(source, next);
        return { name: definition.name, file: workspaceRelative(source), replacements: count };
      },
    }),

    replace_workflow: tool({
      description:
        "Replace the entire YAML of one of this workspace's workflows. Reach for this for wholesale rewrites; for a targeted change to existing text, prefer edit_workflow. Before your first authoring call in a conversation, call read_workflow_authoring_guide and follow it. The new content is validated in full before it is written — a rejected call names what to fix and the file on disk is unchanged. The workflow's name comes from the YAML, so a rewrite may rename it; a rename colliding with another workflow is rejected.",
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .describe("Name of the workflow to replace, exactly as list_workflows reports it."),
        content_yaml: z
          .string()
          .min(1)
          .describe(
            "The complete new YAML file content — it replaces the current file in full. Same shape as create_workflow's content_yaml.",
          ),
      }),
      execute: async ({ name, content_yaml }) => {
        const source = requireSource(name);
        const definition = validateSource(content_yaml);
        requireRenameFree(definition.name, name);
        writeFileSync(source, withTrailingNewline(content_yaml));
        return { name: definition.name, file: workspaceRelative(source) };
      },
    }),
  };
}
