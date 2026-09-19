import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ProjectTaskGroup,
  createProjectTask,
  createProjectTaskGroup,
  deleteProjectTask,
  deleteProjectTaskGroup,
  fetchProjectTasks,
  patchProjectTask,
  patchProjectTaskGroup,
  reorderProjectTaskGroups,
} from "../api.ts";
import { projectTasksKey, projectsKey } from "./query-keys.ts";

/**
 * Read a project's task list — its groups in order, each with its tasks in
 * order. Fetched on first use and served from cache thereafter; kept current
 * by `<LiveSync>`.
 */
export function useProjectTasks(projectId: string): UseQueryResult<ProjectTaskGroup[]> {
  return useQuery({
    queryKey: projectTasksKey(projectId),
    queryFn: async () => (await fetchProjectTasks(projectId)).groups,
  });
}

/**
 * The mutations behind a project's task list, each invalidating the list
 * (and the index, for its counts) once the server has the change. Bound to
 * one project so callers pass only what changes.
 */
export function useProjectTaskMutations(projectId: string): {
  createGroup: (name: string) => Promise<void>;
  updateGroup: (groupId: string, patch: { name?: string; hidden?: boolean }) => Promise<void>;
  reorderGroups: (orderedIds: string[]) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
  createTask: (groupId: string, input: { title: string; note?: string | null }) => Promise<void>;
  updateTask: (
    taskId: string,
    patch: { title?: string; note?: string | null; done?: boolean; groupId?: string },
  ) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
} {
  const queryClient = useQueryClient();
  const settle = () => {
    void queryClient.invalidateQueries({ queryKey: projectTasksKey(projectId) });
    void queryClient.invalidateQueries({ queryKey: projectsKey });
  };
  return {
    createGroup: async (name) => {
      await createProjectTaskGroup(projectId, name);
      settle();
    },
    updateGroup: async (groupId, patch) => {
      await patchProjectTaskGroup(projectId, groupId, patch);
      settle();
    },
    reorderGroups: async (orderedIds) => {
      await reorderProjectTaskGroups(projectId, orderedIds);
      settle();
    },
    deleteGroup: async (groupId) => {
      await deleteProjectTaskGroup(projectId, groupId);
      settle();
    },
    createTask: async (groupId, input) => {
      await createProjectTask(projectId, groupId, input);
      settle();
    },
    updateTask: async (taskId, patch) => {
      await patchProjectTask(projectId, taskId, patch);
      settle();
    },
    deleteTask: async (taskId) => {
      await deleteProjectTask(projectId, taskId);
      settle();
    },
  };
}
