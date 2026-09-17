import type { ProjectTask, ProjectTaskGroup } from "../../../shared/api/project-tasks.ts";
import type { ProjectDetail } from "../../../shared/api/projects.ts";
import type { projects, taskGroups, tasks } from "../../db/schema.ts";
/** Serialize the project's container fields. */
export const serializeProject = (row: typeof projects.$inferSelect): ProjectDetail["project"] => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
});
/** Serialize a project's task. */
export const serializeTask = (row: typeof tasks.$inferSelect): ProjectTask => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
/** Serialize a task group's own fields; its tasks are listed separately. */
export const serializeTaskGroup = (
  row: typeof taskGroups.$inferSelect,
): Omit<ProjectTaskGroup, "tasks"> => ({ ...row, createdAt: row.createdAt.toISOString() });
