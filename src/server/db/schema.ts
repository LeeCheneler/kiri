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
  status: text("status").notNull(),
  trigger: text("trigger").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  error: text("error", { mode: "json" }),
  definitionSnapshot: text("definition_snapshot", { mode: "json" }).notNull(),
});

/**
 * Per-node state for a run. Carries the standard envelope (`status`,
 * `output`, `error`, `traces`, `usage`) plus a `materials` snapshot of the
 * source bytes that produced the node — script source for `script` nodes;
 * prompt and template settings for `agent` nodes from M1+.
 */
export const runNodes = sqliteTable(
  "run_nodes",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    index: integer("index").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    output: text("output", { mode: "json" }),
    error: text("error", { mode: "json" }),
    traces: text("traces", { mode: "json" }),
    usage: text("usage", { mode: "json" }),
    materials: text("materials", { mode: "json" }).notNull(),
  },
  (t) => [index("run_nodes_run_id_idx").on(t.runId)],
);
