import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

export const runNodes = sqliteTable("run_nodes", {
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
});
