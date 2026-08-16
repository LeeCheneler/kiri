import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ProjectTaskGroup,
  createProjectTask,
  createProjectTaskGroup,
  deleteProjectTask,
  deleteProjectTaskGroup,
  fetchProjectTasks,
  patchProjectTask,
  renameProjectTaskGroup,
  reorderProjectTaskGroups,
  reorderProjectTasks,
} from "../api.ts";
import { useLiveEvent, useLiveReconnect } from "../events/live.tsx";

const projectsKey = ["projects"] as const;
const projectTasksKey = (projectId: string) => ["project-tasks", projectId] as const;

/**
 * Read a project's task list — its groups in order, each with its tasks in
 * order. Fetched on first use and served from cache thereafter; kept current
 * by `useProjectTasksLive`, mounted once near the root via `<LiveSync>`.
 */
export function useProjectTasks(projectId: string): UseQueryResult<ProjectTaskGroup[]> {
  return useQuery({
    queryKey: projectTasksKey(projectId),
    queryFn: async () => (await fetchProjectTasks(projectId)).groups,
  });
}

/**
 * Bridges `task.changed` to the task caches: any change to a project's list
 * — from this app or a session's tools — refetches that project's list and
 * the project index (whose cards carry open-task counts). Reconnect re-syncs
 * every list. Mount once near the root via `<LiveSync>`.
 */
export function useProjectTasksLive(): void {
  const queryClient = useQueryClient();
  useLiveEvent({
    on: ["task.changed"],
    handler: (event) => {
      void queryClient.invalidateQueries({ queryKey: projectTasksKey(event.projectId) });
      void queryClient.invalidateQueries({ queryKey: projectsKey });
    },
  });
  useLiveReconnect(() => {
    void queryClient.invalidateQueries({ queryKey: ["project-tasks"] });
  });
}

/**
 * The mutations behind a project's task list, each invalidating the list
 * (and the index, for its counts) once the server has the change. Bound to
 * one project so callers pass only what changes.
 */
export function useProjectTaskMutations(projectId: string): {
  createGroup: (name: string) => Promise<void>;
  renameGroup: (groupId: string, name: string) => Promise<void>;
  reorderGroups: (orderedIds: string[]) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
  createTask: (groupId: string, input: { title: string; note?: string | null }) => Promise<void>;
  updateTask: (
    taskId: string,
    patch: { title?: string; note?: string | null; done?: boolean; groupId?: string },
  ) => Promise<void>;
  reorderTasks: (groupId: string, orderedIds: string[]) => Promise<void>;
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
    renameGroup: async (groupId, name) => {
      await renameProjectTaskGroup(projectId, groupId, name);
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
    reorderTasks: async (groupId, orderedIds) => {
      await reorderProjectTasks(projectId, groupId, orderedIds);
      settle();
    },
    deleteTask: async (taskId) => {
      await deleteProjectTask(projectId, taskId);
      settle();
    },
  };
}
