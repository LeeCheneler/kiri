import type { RunListEntry, RunStepRow } from "../../../shared/api/runs.ts";
import type { runSteps, runs } from "../../db/schema.ts";
/** Serialize a run's persisted fields; feed enrichment is supplied by the route. */
export const serializeRun = (
  row: typeof runs.$inferSelect,
): Omit<RunListEntry, "articles" | "recommendationsCount" | "isInterrupted"> => ({
  ...row,
  startedAt: row.startedAt.toISOString(),
  finishedAt: row.finishedAt?.toISOString() ?? null,
});
/** Serialize one workflow step's execution envelope. */
export const serializeRunStep = (row: typeof runSteps.$inferSelect): RunStepRow => ({
  ...row,
  startedAt: row.startedAt?.toISOString() ?? null,
  finishedAt: row.finishedAt?.toISOString() ?? null,
});
