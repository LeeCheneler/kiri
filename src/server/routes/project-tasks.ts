import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type * as errorsApi from "../../shared/api/errors.ts";
import type * as tasksApi from "../../shared/api/project-tasks.ts";
import type { KiriDb } from "../db/index.ts";
import type { EventBus } from "../events/index.ts";
import { getProject } from "../projects/store.ts";
import {
  createTask,
  createTaskGroup,
  deleteTask,
  deleteTaskGroup,
  getProjectTask,
  getTaskGroup,
  getTaskGroupByName,
  listTaskGroups,
  reorderTaskGroups,
  updateTask,
  updateTaskGroup,
} from "../projects/tasks.ts";
import { serializeTask, serializeTaskGroup } from "./serializers/projects.ts";
import { runIdParamSchema as idParamSchema, onZodFail } from "./shared.ts";

const groupParamSchema = z.object({ id: z.string().min(1), groupId: z.string().min(1) });
const taskParamSchema = z.object({ id: z.string().min(1), taskId: z.string().min(1) });

const groupBodySchema = z
  .object({ name: z.string().trim().min(1) })
  .strict() satisfies z.ZodType<tasksApi.CreateTaskGroupRequest>;
// A group patch carries whichever fields are changing: a new name, or the
// hidden flag that tucks it behind the page's toggle and out of prompts.
const patchGroupBodySchema = z
  .object({ name: z.string().trim().min(1).optional(), hidden: z.boolean().optional() })
  .strict() satisfies z.ZodType<tasksApi.PatchTaskGroupRequest>;
const orderBodySchema = z
  .object({ orderedIds: z.array(z.string().min(1)) })
  .strict() satisfies z.ZodType<tasksApi.ReorderTaskGroupsRequest>;
const taskBodySchema = z
  .object({ title: z.string().trim().min(1), note: z.string().nullable().optional() })
  .strict() satisfies z.ZodType<tasksApi.CreateTaskRequest>;
// A patch carries whichever fields are changing; a null note clears it.
const patchTaskBodySchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    note: z.string().nullable().optional(),
    done: z.boolean().optional(),
    groupId: z.string().min(1).optional(),
  })
  .strict() satisfies z.ZodType<tasksApi.PatchTaskRequest>;

export interface ProjectTasksRoutesDeps {
  db: KiriDb;
  bus?: EventBus;
}

/**
 * HTTP surface for a project's task list, mounted under the projects routes:
 * read the whole list (hidden groups included — the page decides how to show
 * them), create/rename/hide/reorder/delete groups, and
 * create/edit/delete the tasks within them (tasks list by creation). Every mutation publishes
 * `task.changed` for the project so open views refetch the list — one event
 * for the whole surface, since the list is small and always read wholesale.
 */
export function projectTasksRoutes(deps: ProjectTasksRoutesDeps): Hono {
  const { db, bus } = deps;
  const app = new Hono();

  const notFound = (what: string) => ({ error: `${what} not found` });
  const changed = (projectId: string) => bus?.publish({ type: "task.changed", projectId });

  // A group addressed under a project must belong to it — an id from another
  // project's list is treated as absent.
  const projectGroup = (projectId: string, groupId: string) => {
    const group = getTaskGroup(db, groupId);
    return group?.projectId === projectId ? group : undefined;
  };

  app.get(
    "/:id/tasks",
    zValidator("param", idParamSchema, onZodFail("invalid project id")),
    (c) => {
      const { id } = c.req.valid("param");
      if (!getProject(db, id))
        return c.json(notFound(`project "${id}"`) satisfies errorsApi.ApiErrorBody, 404);
      return c.json({
        groups: listTaskGroups(db, id).map((group) => ({
          ...serializeTaskGroup(group),
          tasks: group.tasks.map(serializeTask),
        })),
      } satisfies tasksApi.ProjectTasksResult);
    },
  );

  app.post(
    "/:id/task-groups",
    zValidator("param", idParamSchema, onZodFail("invalid project id")),
    zValidator("json", groupBodySchema, onZodFail("invalid task group")),
    (c) => {
      const { id } = c.req.valid("param");
      const { name } = c.req.valid("json");
      if (!getProject(db, id))
        return c.json(notFound(`project "${id}"`) satisfies errorsApi.ApiErrorBody, 404);
      if (getTaskGroupByName(db, id, name)) {
        return c.json(
          { error: `task group "${name}" already exists` } satisfies errorsApi.ApiErrorBody,
          409,
        );
      }
      const group = createTaskGroup(db, id, name);
      changed(id);
      return c.json({ group: serializeTaskGroup(group) } satisfies tasksApi.TaskGroupResult, 201);
    },
  );

  app.put(
    "/:id/task-groups",
    zValidator("param", idParamSchema, onZodFail("invalid project id")),
    zValidator("json", orderBodySchema, onZodFail("invalid order")),
    (c) => {
      const { id } = c.req.valid("param");
      if (!getProject(db, id))
        return c.json(notFound(`project "${id}"`) satisfies errorsApi.ApiErrorBody, 404);
      reorderTaskGroups(db, id, c.req.valid("json").orderedIds);
      changed(id);
      return c.body(null, 204);
    },
  );

  app.patch(
    "/:id/task-groups/:groupId",
    zValidator("param", groupParamSchema, onZodFail("invalid task group id")),
    zValidator("json", patchGroupBodySchema, onZodFail("invalid task group")),
    (c) => {
      const { id, groupId } = c.req.valid("param");
      const patch = c.req.valid("json");
      const group = projectGroup(id, groupId);
      if (!group)
        return c.json(notFound(`task group "${groupId}"`) satisfies errorsApi.ApiErrorBody, 404);
      const clash = patch.name !== undefined ? getTaskGroupByName(db, id, patch.name) : undefined;
      if (clash && clash.id !== groupId) {
        return c.json(
          { error: `task group "${patch.name}" already exists` } satisfies errorsApi.ApiErrorBody,
          409,
        );
      }
      const updated = updateTaskGroup(db, groupId, patch);
      changed(id);
      return c.json({ group: serializeTaskGroup(updated) } satisfies tasksApi.TaskGroupResult);
    },
  );

  app.delete(
    "/:id/task-groups/:groupId",
    zValidator("param", groupParamSchema, onZodFail("invalid task group id")),
    (c) => {
      const { id, groupId } = c.req.valid("param");
      if (!projectGroup(id, groupId))
        return c.json(notFound(`task group "${groupId}"`) satisfies errorsApi.ApiErrorBody, 404);
      deleteTaskGroup(db, groupId);
      changed(id);
      return c.body(null, 204);
    },
  );

  app.post(
    "/:id/task-groups/:groupId/tasks",
    zValidator("param", groupParamSchema, onZodFail("invalid task group id")),
    zValidator("json", taskBodySchema, onZodFail("invalid task")),
    (c) => {
      const { id, groupId } = c.req.valid("param");
      if (!projectGroup(id, groupId))
        return c.json(notFound(`task group "${groupId}"`) satisfies errorsApi.ApiErrorBody, 404);
      const task = createTask(db, groupId, c.req.valid("json"));
      changed(id);
      return c.json({ task: serializeTask(task) } satisfies tasksApi.TaskResult, 201);
    },
  );

  app.patch(
    "/:id/tasks/:taskId",
    zValidator("param", taskParamSchema, onZodFail("invalid task id")),
    zValidator("json", patchTaskBodySchema, onZodFail("invalid task")),
    (c) => {
      const { id, taskId } = c.req.valid("param");
      const patch = c.req.valid("json");
      if (!getProjectTask(db, id, taskId))
        return c.json(notFound(`task "${taskId}"`) satisfies errorsApi.ApiErrorBody, 404);
      if (patch.groupId !== undefined && !projectGroup(id, patch.groupId)) {
        return c.json(
          notFound(`task group "${patch.groupId}"`) satisfies errorsApi.ApiErrorBody,
          404,
        );
      }
      const task = updateTask(db, taskId, patch);
      changed(id);
      return c.json({ task: serializeTask(task) } satisfies tasksApi.TaskResult);
    },
  );

  app.delete(
    "/:id/tasks/:taskId",
    zValidator("param", taskParamSchema, onZodFail("invalid task id")),
    (c) => {
      const { id, taskId } = c.req.valid("param");
      if (!getProjectTask(db, id, taskId))
        return c.json(notFound(`task "${taskId}"`) satisfies errorsApi.ApiErrorBody, 404);
      deleteTask(db, taskId);
      changed(id);
      return c.body(null, 204);
    },
  );

  return app;
}
