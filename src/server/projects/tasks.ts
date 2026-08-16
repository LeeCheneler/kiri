import { and, asc, count, eq, inArray, isNotNull, max } from "drizzle-orm";
import type { KiriDb } from "../db/index.ts";
import { taskGroups, tasks } from "../db/schema.ts";

/** A persisted task group row. */
export type TaskGroup = typeof taskGroups.$inferSelect;
/** A persisted task row. */
export type Task = typeof tasks.$inferSelect;

/** One group of a project's task list with its tasks in position order. */
export interface TaskGroupWithTasks extends TaskGroup {
  tasks: Task[];
}

/** Open (not done) task counts per project, for listing surfaces. */
export type OpenTaskCounts = Map<string, number>;

/** Read one group by id, or `undefined` if none exists. */
export function getTaskGroup(db: KiriDb, id: string): TaskGroup | undefined {
  return db.select().from(taskGroups).where(eq(taskGroups.id, id)).get();
}

/** Read one group of `projectId` by name, or `undefined` if none exists. */
export function getTaskGroupByName(
  db: KiriDb,
  projectId: string,
  name: string,
): TaskGroup | undefined {
  return db
    .select()
    .from(taskGroups)
    .where(and(eq(taskGroups.projectId, projectId), eq(taskGroups.name, name)))
    .get();
}

/** Read one task by id, or `undefined` if none exists. */
export function getTask(db: KiriDb, id: string): Task | undefined {
  return db.select().from(tasks).where(eq(tasks.id, id)).get();
}

/**
 * Read one task by id, but only when it belongs to `projectId` — the check
 * every project-addressed surface needs so an id can't reach across projects.
 */
export function getProjectTask(db: KiriDb, projectId: string, taskId: string): Task | undefined {
  const task = getTask(db, taskId);
  if (!task) return undefined;
  const group = getTaskGroup(db, task.groupId);
  return group?.projectId === projectId ? task : undefined;
}

/**
 * A project's whole task list: its groups in position order, each carrying
 * its tasks in position order. Two queries regardless of size.
 */
export function listTaskGroups(db: KiriDb, projectId: string): TaskGroupWithTasks[] {
  const groups = db
    .select()
    .from(taskGroups)
    .where(eq(taskGroups.projectId, projectId))
    .orderBy(asc(taskGroups.position), asc(taskGroups.createdAt))
    .all();
  if (groups.length === 0) return [];
  const rows = db
    .select()
    .from(tasks)
    .where(
      inArray(
        tasks.groupId,
        groups.map((group) => group.id),
      ),
    )
    .orderBy(asc(tasks.position), asc(tasks.createdAt))
    .all();
  const byGroup = new Map<string, Task[]>(groups.map((group) => [group.id, []]));
  for (const row of rows) byGroup.get(row.groupId)?.push(row);
  return groups.map((group) => ({ ...group, tasks: byGroup.get(group.id) ?? [] }));
}

/**
 * Open-task counts across every project that has any, keyed by project id —
 * a project with no open tasks is simply absent. One grouped query for the
 * projects index.
 */
export function countOpenTasksByProject(db: KiriDb): OpenTaskCounts {
  return new Map(
    db
      .select({ projectId: taskGroups.projectId, count: count() })
      .from(tasks)
      .innerJoin(taskGroups, eq(tasks.groupId, taskGroups.id))
      .where(and(eq(tasks.done, false), isNotNull(taskGroups.projectId)))
      .groupBy(taskGroups.projectId)
      .all()
      .map((row) => [row.projectId, row.count]),
  );
}

// Next free position within a group's tasks / a project's groups: one past
// the current maximum, so a new item lands at the end.
const nextGroupPosition = (db: KiriDb, projectId: string): number => {
  const row = db
    .select({ max: max(taskGroups.position) })
    .from(taskGroups)
    .where(eq(taskGroups.projectId, projectId))
    .get();
  return (row?.max ?? -1) + 1;
};

const nextTaskPosition = (db: KiriDb, groupId: string): number => {
  const row = db
    .select({ max: max(tasks.position) })
    .from(tasks)
    .where(eq(tasks.groupId, groupId))
    .get();
  return (row?.max ?? -1) + 1;
};

/**
 * Create a group named `name` at the end of the project's list. Names are
 * unique per project; creating a duplicate throws from the unique index.
 * Returns the persisted row.
 */
export function createTaskGroup(
  db: KiriDb,
  projectId: string,
  name: string,
  opts: { id?: string; createdAt?: Date } = {},
): TaskGroup {
  const id = opts.id ?? crypto.randomUUID();
  db.insert(taskGroups)
    .values({
      id,
      projectId,
      name: name.trim(),
      position: nextGroupPosition(db, projectId),
      createdAt: opts.createdAt ?? new Date(),
    })
    .run();
  return getTaskGroup(db, id) as TaskGroup;
}

/** The group named `name` in `projectId`, created at the end of the list if absent. */
export function ensureTaskGroup(db: KiriDb, projectId: string, name: string): TaskGroup {
  return getTaskGroupByName(db, projectId, name.trim()) ?? createTaskGroup(db, projectId, name);
}

/** Rename a group. A display change only — nothing keys off the name. Returns the updated row. */
export function renameTaskGroup(db: KiriDb, id: string, name: string): TaskGroup {
  db.update(taskGroups).set({ name: name.trim() }).where(eq(taskGroups.id, id)).run();
  return getTaskGroup(db, id) as TaskGroup;
}

/**
 * Reorder a project's groups to match `orderedIds`, renumbering positions
 * from zero. Ids missing from the list keep their relative order after the
 * listed ones; ids that aren't the project's groups are ignored.
 */
export function reorderTaskGroups(db: KiriDb, projectId: string, orderedIds: string[]): void {
  const current = listTaskGroups(db, projectId).map((group) => group.id);
  const known = new Set(current);
  const ordered = [
    ...orderedIds.filter((id) => known.has(id)),
    ...current.filter((id) => !orderedIds.includes(id)),
  ];
  db.transaction((tx) => {
    ordered.forEach((id, position) => {
      tx.update(taskGroups).set({ position }).where(eq(taskGroups.id, id)).run();
    });
  });
}

/** Permanently delete a group and every task in it. Deleting an absent group removes nothing. */
export function deleteTaskGroup(db: KiriDb, id: string): void {
  db.transaction((tx) => {
    tx.delete(tasks).where(eq(tasks.groupId, id)).run();
    tx.delete(taskGroups).where(eq(taskGroups.id, id)).run();
  });
}

/** Create a task at the end of `groupId`. Returns the persisted row. */
export function createTask(
  db: KiriDb,
  groupId: string,
  input: { title: string; note?: string | null },
  opts: { id?: string; createdAt?: Date } = {},
): Task {
  const id = opts.id ?? crypto.randomUUID();
  const now = opts.createdAt ?? new Date();
  db.insert(tasks)
    .values({
      id,
      groupId,
      title: input.title.trim(),
      note: normaliseNote(input.note),
      done: false,
      position: nextTaskPosition(db, groupId),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return getTask(db, id) as Task;
}

/**
 * Update a task's title, note, completion, or group, leaving anything the
 * patch omits untouched. Moving to another group appends the task to that
 * group's end. `updatedAt` bumps whenever anything changes. Returns the
 * updated row.
 */
export function updateTask(
  db: KiriDb,
  id: string,
  patch: { title?: string; note?: string | null; done?: boolean; groupId?: string },
): Task {
  const current = getTask(db, id) as Task;
  const moving = patch.groupId !== undefined && patch.groupId !== current.groupId;
  const changes = {
    ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    ...(patch.note !== undefined ? { note: normaliseNote(patch.note) } : {}),
    ...(patch.done !== undefined ? { done: patch.done } : {}),
    ...(moving
      ? { groupId: patch.groupId, position: nextTaskPosition(db, patch.groupId as string) }
      : {}),
  };
  if (Object.keys(changes).length > 0) {
    db.update(tasks)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .run();
  }
  return getTask(db, id) as Task;
}

/**
 * Reorder a group's tasks to match `orderedIds`, renumbering positions from
 * zero. Same tolerance as group reordering: unlisted tasks trail in their
 * existing order, foreign ids are ignored.
 */
export function reorderTasks(db: KiriDb, groupId: string, orderedIds: string[]): void {
  const current = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.groupId, groupId))
    .orderBy(asc(tasks.position), asc(tasks.createdAt))
    .all()
    .map((row) => row.id);
  const known = new Set(current);
  const ordered = [
    ...orderedIds.filter((id) => known.has(id)),
    ...current.filter((id) => !orderedIds.includes(id)),
  ];
  db.transaction((tx) => {
    ordered.forEach((id, position) => {
      tx.update(tasks).set({ position }).where(eq(tasks.id, id)).run();
    });
  });
}

/** Permanently delete a task. Deleting an absent task removes nothing. */
export function deleteTask(db: KiriDb, id: string): void {
  db.delete(tasks).where(eq(tasks.id, id)).run();
}

// A note is markdown or nothing: blank bodies are stored as null so "no note"
// has one representation.
function normaliseNote(note: string | null | undefined): string | null {
  if (note === undefined || note === null) return null;
  const trimmed = note.trim();
  return trimmed === "" ? null : trimmed;
}
