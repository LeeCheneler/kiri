import type {
  CreateTaskRequest,
  PatchTaskGroupRequest,
  PatchTaskRequest,
  ProjectTasksResult,
  TaskGroupResult,
  TaskResult,
} from "../../shared/api/project-tasks.ts";
import type * as requests from "../../shared/api/project-tasks.ts";

import { apiFetch, assertOk, json } from "./http.ts";

const projectTasksPath = (projectId: string, rest = "") =>
  `/api/projects/${encodeURIComponent(projectId)}${rest}`;

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Fetch a project's whole task list: groups in order, each with its tasks in order. Throws on non-2xx. */
export const fetchProjectTasks = async (projectId: string): Promise<ProjectTasksResult> =>
  json<ProjectTasksResult>(await apiFetch(projectTasksPath(projectId, "/tasks")));

/** Create a task group at the end of the project's list. Throws `ApiError` on non-2xx (409 on a name clash). */
export const createProjectTaskGroup = async (
  projectId: string,
  name: string,
): Promise<TaskGroupResult> =>
  json<TaskGroupResult>(
    await apiFetch(
      projectTasksPath(projectId, "/task-groups"),
      jsonInit("POST", { name } satisfies requests.CreateTaskGroupRequest),
    ),
  );

/** Rename and/or hide a task group. Omitted fields keep their value. Throws `ApiError` on non-2xx (409 on a name clash). */
export const patchProjectTaskGroup = async (
  projectId: string,
  groupId: string,
  patch: PatchTaskGroupRequest,
): Promise<TaskGroupResult> =>
  json<TaskGroupResult>(
    await apiFetch(
      projectTasksPath(projectId, `/task-groups/${encodeURIComponent(groupId)}`),
      jsonInit("PATCH", patch satisfies requests.PatchTaskGroupRequest),
    ),
  );

/** Reorder a project's task groups to `orderedIds`. Throws `ApiError` on non-2xx. */
export const reorderProjectTaskGroups = async (
  projectId: string,
  orderedIds: string[],
): Promise<void> => {
  await assertOk(
    await apiFetch(
      projectTasksPath(projectId, "/task-groups"),
      jsonInit("PUT", { orderedIds } satisfies requests.ReorderTaskGroupsRequest),
    ),
  );
};

/** Delete a task group and every task in it. Throws `ApiError` on non-2xx. */
export const deleteProjectTaskGroup = async (projectId: string, groupId: string): Promise<void> => {
  await assertOk(
    await apiFetch(projectTasksPath(projectId, `/task-groups/${encodeURIComponent(groupId)}`), {
      method: "DELETE",
    }),
  );
};

/** Create a task in a group. Throws `ApiError` on non-2xx. */
export const createProjectTask = async (
  projectId: string,
  groupId: string,
  input: CreateTaskRequest,
): Promise<TaskResult> =>
  json<TaskResult>(
    await apiFetch(
      projectTasksPath(projectId, `/task-groups/${encodeURIComponent(groupId)}/tasks`),
      jsonInit("POST", input satisfies requests.CreateTaskRequest),
    ),
  );

/**
 * Update a task's title, note (null clears), completion, or group. Omitted
 * fields keep their value. Throws `ApiError` on non-2xx.
 */
export const patchProjectTask = async (
  projectId: string,
  taskId: string,
  patch: PatchTaskRequest,
): Promise<TaskResult> =>
  json<TaskResult>(
    await apiFetch(
      projectTasksPath(projectId, `/tasks/${encodeURIComponent(taskId)}`),
      jsonInit("PATCH", patch satisfies requests.PatchTaskRequest),
    ),
  );

/** Delete a task permanently. Throws `ApiError` on non-2xx. */
export const deleteProjectTask = async (projectId: string, taskId: string): Promise<void> => {
  await assertOk(
    await apiFetch(projectTasksPath(projectId, `/tasks/${encodeURIComponent(taskId)}`), {
      method: "DELETE",
    }),
  );
};
