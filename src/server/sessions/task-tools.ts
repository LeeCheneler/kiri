import { type ToolSet, tool } from "ai";
import { z } from "zod";
import type { KiriDb } from "../db/index.ts";
import type { KiriEvent } from "../events/index.ts";
import {
  type Task,
  type TaskGroup,
  createTask,
  createTaskGroup,
  deleteTask,
  deleteTaskGroup,
  ensureTaskGroup,
  getProjectTask,
  getTaskGroupByName,
  listTaskGroups,
  renameTaskGroup,
  reorderTaskGroups,
  reorderTasks,
  updateTask,
} from "../projects/tasks.ts";

/** Counts of a project's task list carried by the system prompt: groups and open tasks. */
export interface TaskListSummary {
  groups: number;
  open: number;
}

/** Group and open-task counts for `projectId` — the prompt's task-list line. */
export function summariseTaskList(db: KiriDb, projectId: string): TaskListSummary {
  const groups = listTaskGroups(db, projectId);
  return {
    groups: groups.length,
    open: groups.reduce(
      (total, group) => total + group.tasks.filter((task) => !task.done).length,
      0,
    ),
  };
}

const groupNameSchema = z.string().trim().min(1);

// The task shape the model sees: id, title, done, and the note when there is
// one. Positions are implied by order, timestamps are noise.
const presentTask = (task: Task) => ({
  id: task.id,
  title: task.title,
  done: task.done,
  ...(task.note !== null ? { note: task.note } : {}),
});

// Move `id` to `index` within `ids`, clamping to the ends.
const moveTo = (ids: string[], id: string, index: number): string[] => {
  const rest = ids.filter((other) => other !== id);
  const at = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
};

/**
 * First-party tools that let a project session manage the project's task
 * list — the same grouped checklist the user edits on the project page, with
 * full parity: list it, add and update and delete tasks, and create, rename,
 * reorder, and delete the groups they sit in. Groups are addressed by name
 * (unique within the project; `add_task` creates a missing group on the fly),
 * tasks by the id `list_tasks` returns. Offered only to a session inside a
 * project; a projectless session gets nothing. Every write publishes
 * `task.changed` for the project so open views refetch the list. Expected
 * failures (unknown id or group) throw with a message pointing at
 * `list_tasks` — the SDK surfaces it to the model as a tool error and the
 * turn continues.
 */
export function taskTools(
  db: KiriDb,
  projectId: string | null,
  publish: (event: KiriEvent) => void,
): ToolSet {
  if (projectId === null) return {};

  const announce = (): void => publish({ type: "task.changed", projectId });

  const requireTask = (id: string): Task => {
    const task = getProjectTask(db, projectId, id);
    if (!task) throw new Error(`No task with id "${id}" — call list_tasks to see the current ids.`);
    return task;
  };

  const requireGroup = (name: string): TaskGroup => {
    const group = getTaskGroupByName(db, projectId, name.trim());
    if (!group) {
      throw new Error(`No task group named "${name}" — call list_tasks to see the current groups.`);
    }
    return group;
  };

  return {
    list_tasks: tool({
      description:
        "List the project's task list: every group in order, each with its tasks in order — id, title, whether it's done, and any note. Call it before updating or deleting a task to get current ids, and whenever the user asks what's outstanding.",
      inputSchema: z.object({}),
      execute: async () => ({
        groups: listTaskGroups(db, projectId).map((group) => ({
          name: group.name,
          tasks: group.tasks.map(presentTask),
        })),
      }),
    }),

    add_task: tool({
      description:
        "Add a task to the project's task list, under the named group — created if it doesn't exist yet. Use it when the user asks for something to be tracked, or when work you're doing surfaces a follow-up worth keeping. Keep titles short and actionable; put context in the note.",
      inputSchema: z.object({
        group: groupNameSchema.describe(
          'Group to file the task under, e.g. "Now" or "Backlog". An unknown name creates the group at the end of the list.',
        ),
        title: z.string().trim().min(1).describe("Short, actionable title."),
        note: z
          .string()
          .optional()
          .describe("Optional markdown context — why it matters, links, what's blocking it."),
      }),
      execute: async ({ group, title, note }) => {
        const target = ensureTaskGroup(db, projectId, group);
        const task = createTask(db, target.id, { title, note });
        announce();
        return { group: target.name, task: presentTask(task) };
      },
    }),

    update_task: tool({
      description:
        "Update a task: mark it done or not done, retitle it, change its note, move it to another group, or reposition it within its group. Mark a task done as soon as the user says it's finished, or when you've completed it yourself. Only the fields you pass change.",
      inputSchema: z.object({
        id: z.string().min(1).describe("Task id from list_tasks."),
        done: z.boolean().optional().describe("Completion state."),
        title: z.string().trim().min(1).optional().describe("New title."),
        note: z
          .string()
          .nullable()
          .optional()
          .describe("New markdown note; pass null to clear it."),
        group: groupNameSchema
          .optional()
          .describe("Move to this group (created if missing); the task lands at that group's end."),
        position: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Zero-based index to move the task to within its group."),
      }),
      execute: async ({ id, done, title, note, group, position }) => {
        requireTask(id);
        const targetGroup = group !== undefined ? ensureTaskGroup(db, projectId, group) : undefined;
        let task = updateTask(db, id, {
          ...(done !== undefined ? { done } : {}),
          ...(title !== undefined ? { title } : {}),
          ...(note !== undefined ? { note } : {}),
          ...(targetGroup !== undefined ? { groupId: targetGroup.id } : {}),
        });
        if (position !== undefined) {
          const siblings = listTaskGroups(db, projectId)
            .find((candidate) => candidate.id === task.groupId)
            ?.tasks.map((sibling) => sibling.id) as string[];
          reorderTasks(db, task.groupId, moveTo(siblings, id, position));
          task = requireTask(id);
        }
        announce();
        return { task: presentTask(task) };
      },
    }),

    delete_task: tool({
      description:
        "Delete a task permanently. Use it when the user asks, or for a task that's plainly a duplicate or no longer applies — otherwise prefer marking it done.",
      inputSchema: z.object({ id: z.string().min(1).describe("Task id from list_tasks.") }),
      execute: async ({ id }) => {
        const task = requireTask(id);
        deleteTask(db, id);
        announce();
        return { id, title: task.title, deleted: true };
      },
    }),

    create_task_group: tool({
      description:
        "Create an empty task group at the end of the project's task list. add_task creates groups on the fly, so reach for this only when the user wants a group set up ahead of its tasks.",
      inputSchema: z.object({
        name: groupNameSchema.describe("Group name, unique within the project."),
      }),
      execute: async ({ name }) => {
        if (getTaskGroupByName(db, projectId, name.trim())) {
          throw new Error(`A task group named "${name}" already exists.`);
        }
        const group = createTaskGroup(db, projectId, name);
        announce();
        return { group: group.name, created: true };
      },
    }),

    update_task_group: tool({
      description:
        "Rename a task group or move it to another position in the list. Only the fields you pass change.",
      inputSchema: z.object({
        name: groupNameSchema.describe("Current group name."),
        new_name: groupNameSchema.optional().describe("New name, unique within the project."),
        position: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Zero-based index to move the group to."),
      }),
      execute: async ({ name, new_name, position }) => {
        let group = requireGroup(name);
        if (new_name !== undefined) {
          const clash = getTaskGroupByName(db, projectId, new_name.trim());
          if (clash && clash.id !== group.id) {
            throw new Error(`A task group named "${new_name}" already exists.`);
          }
          group = renameTaskGroup(db, group.id, new_name);
        }
        if (position !== undefined) {
          const ids = listTaskGroups(db, projectId).map((candidate) => candidate.id);
          reorderTaskGroups(db, projectId, moveTo(ids, group.id, position));
        }
        announce();
        return { group: group.name, updated: true };
      },
    }),

    delete_task_group: tool({
      description:
        "Delete a task group and every task in it, permanently. Only when the user asks — move tasks elsewhere with update_task first if any should survive.",
      inputSchema: z.object({ name: groupNameSchema.describe("Group name.") }),
      execute: async ({ name }) => {
        const group = requireGroup(name);
        deleteTaskGroup(db, group.id);
        announce();
        return { group: group.name, deleted: true };
      },
    }),
  };
}
