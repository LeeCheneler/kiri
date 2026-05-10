import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
});

/**
 * Per-step state for a run. Carries the standard envelope (`status`,
 * `output`, `error`, `traces`, `usage`) plus a `materials` snapshot of the
 * source bytes that produced the step.
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
    usage: text("usage", { mode: "json" }),
    materials: text("materials", { mode: "json" }).notNull(),
    /**
     * Marks the row as the workflow's `summarize:` execution rather than
     * a member of the `steps:` pipeline. Set on the single summariser row
     * a run produces; the UI hides these from the main step list and
     * surfaces them in a dedicated section.
     */
    isSummary: integer("is_summary", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("run_steps_run_id_idx").on(t.runId)],
);
