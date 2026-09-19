import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { KiriDb } from "../db/index.ts";
import { articles, memories, projects, sessions, taskGroups, tasks } from "../db/schema.ts";
import { type DeletedSession, deleteSessions } from "../sessions/store.ts";

/** A persisted project row. */
export type Project = typeof projects.$inferSelect;

/** Insert a new project named `name`. Returns the persisted row. */
export function createProject(
  db: KiriDb,
  name: string,
  opts: { id?: string; createdAt?: Date } = {},
): Project {
  const id = opts.id ?? crypto.randomUUID();
  db.insert(projects)
    .values({ id, name, createdAt: opts.createdAt ?? new Date() })
    .run();
  return getProject(db, id) as Project;
}

/** Read a project by id, or `undefined` if none exists. */
export function getProject(db: KiriDb, id: string): Project | undefined {
  return db.select().from(projects).where(eq(projects.id, id)).get();
}

/** List all projects, newest first. */
export function listProjects(db: KiriDb): Project[] {
  return db.select().from(projects).orderBy(desc(projects.createdAt), desc(projects.id)).all();
}

/**
 * Update a project's name and/or standing instructions, leaving anything the
 * patch omits untouched. The name is a display change only — nothing keys off
 * it — while instructions are normalised: a blank body is stored as null, the
 * project simply having none. Returns the updated row.
 */
export function updateProject(
  db: KiriDb,
  id: string,
  patch: { name?: string; instructions?: string },
): Project {
  const changes = {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.instructions !== undefined
      ? { instructions: patch.instructions.trim() === "" ? null : patch.instructions.trim() }
      : {}),
  };
  if (Object.keys(changes).length > 0) {
    db.update(projects).set(changes).where(eq(projects.id, id)).run();
  }
  return getProject(db, id) as Project;
}

/** A project operation refused because of the state its sessions are in. */
export class ProjectConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectConflictError";
  }
}

/**
 * Permanently delete a project and everything in its container: the
 * project's articles, memories, and task list, its sessions — including the
 * delegate children those sessions spawned — and those sessions' messages,
 * articles, and inbox rows, in one transaction. An in-code cascade matching
 * the rest of the codebase rather than a schema-level ON DELETE.
 *
 * A session or delegated worker with a turn running refuses the delete with
 * `ProjectConflictError` until it is cancelled — matching the session
 * cascade, including workers that carry no project id of their own. Returns
 * every session deleted with the project, for announcing; deleting an absent
 * project removes nothing.
 */
export function deleteProject(db: KiriDb, id: string): DeletedSession[] {
  return db.transaction((tx) => {
    const sessionIds = tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.projectId, id))
      .all()
      .map((row) => row.id);

    const running = tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.status, "running"),
          or(
            eq(sessions.projectId, id),
            inArray(
              sessions.parentSessionId,
              tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.projectId, id)),
            ),
          ),
        ),
      )
      .get();
    if (running) {
      throw new ProjectConflictError(
        `project "${id}" has a session or delegated worker running; cancel it first`,
      );
    }

    const deleted = deleteSessions(tx, sessionIds);
    tx.delete(articles).where(eq(articles.projectId, id)).run();
    tx.delete(memories).where(eq(memories.projectId, id)).run();
    const groupIds = tx
      .select({ id: taskGroups.id })
      .from(taskGroups)
      .where(eq(taskGroups.projectId, id))
      .all()
      .map((row) => row.id);
    if (groupIds.length > 0) tx.delete(tasks).where(inArray(tasks.groupId, groupIds)).run();
    tx.delete(taskGroups).where(eq(taskGroups.projectId, id)).run();
    tx.delete(projects).where(eq(projects.id, id)).run();

    return deleted;
  });
}
