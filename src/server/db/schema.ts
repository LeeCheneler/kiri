import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * One row per workflow invocation. `definition_snapshot` captures the
 * resolved workflow definition at run start so feed entries always reflect
 * the exact code that ran, even after the workflow file changes or is
 * deleted.
 */
export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  workflowName: text("workflow_name").notNull(),
  /**
   * Run lifecycle: `"running"` at insert → `"ok"`, `"failed"`, or
   * `"cancelled"` when the runner finalizes. Feed-view consumers must
   * handle all four states — in-flight rows render as live runs.
   */
  status: text("status").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  error: text("error", { mode: "json" }),
  definitionSnapshot: text("definition_snapshot", { mode: "json" }).notNull(),
  /**
   * Trimmed stdout of the workflow's `summarize:` step, when one is
   * configured and exits successfully. Null on workflows without a
   * summarize step, on cancelled runs (where the summariser is skipped),
   * and on runs whose summariser failed.
   */
  summary: text("summary"),
  /**
   * HEAD commit of the data repo at run-start. Null when the data
   * directory is not a git repo or has no commits yet. Paired with
   * `gitDirty` so consumers can render "ran at <sha> (dirty)" and
   * reproduce the run state with `git checkout`.
   */
  gitSha: text("git_sha"),
  /**
   * Whether the working tree had uncommitted changes at run-start.
   * Null when `gitSha` is null (no repo to compare against).
   */
  gitDirty: integer("git_dirty", { mode: "boolean" }),
  /**
   * Resolved input values captured at run-start. Null when the workflow
   * declared no `inputs:` block; otherwise a `Record<string, string>` with
   * one entry per declared input that resolved to a value (supplied at
   * invoke, or via the input's `default`). Step `env:` references of the
   * form `{ input: <name> }` resolve against this snapshot at spawn.
   */
  inputs: text("inputs", { mode: "json" }),
});

/**
 * Per-step state for a run. Carries the standard envelope: `status`,
 * `output`, `error`, `traces`. Reproducibility of the source bytes
 * that produced the step lives on `runs.gitSha` — the data repo
 * commit at run-start — rather than per-step file snapshots.
 */
export const runSteps = sqliteTable(
  "run_steps",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    index: integer("index").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    /**
     * Wall-clock span of the step's execution: `startedAt` is stamped at
     * insert (when the row is first written as `running`); `finishedAt` is
     * stamped at the terminal update. Their difference is the duration the
     * UI shows once a step completes, and `startedAt` alone anchors the live
     * elapsed timer while it runs. Both nullable: rows predating these
     * columns have neither, and a running row carries `startedAt` with no
     * `finishedAt` yet.
     */
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    /**
     * Step output. `mode: "json"` round-trips through `JSON.stringify`, so
     * a string lands in the cell *quoted* (drizzle re-parses on read;
     * matters only for raw SQL inspection).
     */
    output: text("output", { mode: "json" }),
    error: text("error", { mode: "json" }),
    traces: text("traces", { mode: "json" }),
    /**
     * Marks the row as the workflow's `summarize:` execution rather than
     * a member of the `steps:` pipeline. Set on the single summariser row
     * a run produces; the UI hides these from the main step list and
     * surfaces them in a dedicated section.
     */
    isSummary: integer("is_summary", { mode: "boolean" }).notNull().default(false),
    /**
     * Marks the row as one of the workflow's `publish:` executions rather
     * than a member of the `steps:` pipeline. Set on each publish row a
     * run produces; the UI hides these from the main step list and
     * surfaces them via the article view.
     */
    isPublish: integer("is_publish", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("run_steps_run_id_idx").on(t.runId)],
);

/**
 * One row per published article a run produced. Populated after `steps:`
 * complete (when the workflow defines `publish:`) and read back to render
 * article chips on the feed and the dedicated article page. `slug` is the
 * URL/identifier; `name` is the resolved display label — never null — so
 * write-time titlecasing doesn't leak into read paths.
 */
export const articles = sqliteTable(
  "articles",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    contentMd: text("content_md").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("articles_run_id_slug_unique").on(t.runId, t.slug),
    index("articles_run_id_idx").on(t.runId),
  ],
);

/**
 * One proposed follow-up workflow invocation emitted by a run. Rows are
 * created at step-completion time from the step's recommendations file
 * channel; reads power the run detail page's "Recommended" section.
 * `actionedRunId` + `actionedAt` move from null to populated when the
 * user triggers the recommendation and link to the spawned run.
 */
export const recommendations = sqliteTable(
  "recommendations",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    /** Emission order within the producing run. */
    index: integer("index").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    /** Name of the workflow to invoke when the recommendation is actioned. */
    workflow: text("workflow").notNull(),
    /** Pre-fills for the invoke modal. `Record<string, string>` keyed by input name. */
    inputs: text("inputs", { mode: "json" }),
    actionedRunId: text("actioned_run_id").references(() => runs.id),
    actionedAt: integer("actioned_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("recommendations_run_id_idx").on(t.runId),
    index("recommendations_actioned_run_id_idx").on(t.actionedRunId),
  ],
);
