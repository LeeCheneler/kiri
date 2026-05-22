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
  trigger: text("trigger").notNull(),
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
 * article chips on the feed and the dedicated article page. `title` is
 * the resolved display title — never null — so write-time titlecasing
 * doesn't leak into read paths.
 */
export const articles = sqliteTable(
  "articles",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    name: text("name").notNull(),
    title: text("title").notNull(),
    contentMd: text("content_md").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("articles_run_id_name_unique").on(t.runId, t.name),
    index("articles_run_id_idx").on(t.runId),
  ],
);
