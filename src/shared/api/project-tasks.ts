/** One task of a project's task list. `note` is markdown, null when absent. */
export interface ProjectTask {
  id: string;
  groupId: string;
  title: string;
  done: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One group of a project's task list with its tasks in order. `hidden` tucks a finished group behind the page's toggle and out of sessions' default view. */
export interface ProjectTaskGroup {
  id: string;
  projectId: string;
  name: string;
  position: number;
  hidden: boolean;
  createdAt: string;
  tasks: ProjectTask[];
}

/** ProjectTasks response body. */
export type ProjectTasksResult = { groups: ProjectTaskGroup[] };

/** TaskGroup response body. */
export type TaskGroupResult = { group: Omit<ProjectTaskGroup, "tasks"> };

/** Task response body. */
export type TaskResult = { task: ProjectTask };

/** CreateTaskGroup request body. */
export type CreateTaskGroupRequest = { name: string };

/** PatchTaskGroup request body. */
export type PatchTaskGroupRequest = { name?: string; hidden?: boolean };

/** ReorderTaskGroups request body. */
export type ReorderTaskGroupsRequest = { orderedIds: string[] };

/** CreateTask request body. */
export type CreateTaskRequest = { title: string; note?: string | null };

/** PatchTask request body. */
export type PatchTaskRequest = {
  title?: string;
  note?: string | null;
  done?: boolean;
  groupId?: string;
};
