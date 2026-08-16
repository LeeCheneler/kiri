import { desc, eq, inArray } from "drizzle-orm";
import { extractFirstHeading } from "../../shared/extract-first-heading.ts";
import type { KiriDb } from "../db/index.ts";
import {
  articles,
  memories,
  messages,
  projects,
  sessions,
  taskGroups,
  tasks,
} from "../db/schema.ts";

/** A persisted project row. */
export type Project = typeof projects.$inferSelect;

/** One entry of a project's article index: summary metadata plus the body's derived first heading. */
export interface ProjectArticleSummary {
  slug: string;
  name: string;
  heading: string | null;
  createdAt: Date;
}

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
 * A project's article index, newest first. The body is read only to derive
 * each entry's heading, never returned — detail surfaces serve it.
 */
export function listProjectArticles(db: KiriDb, projectId: string): ProjectArticleSummary[] {
  return db
    .select()
    .from(articles)
    .where(eq(articles.projectId, projectId))
    .orderBy(desc(articles.createdAt), desc(articles.id))
    .all()
    .map((article) => ({
      slug: article.slug,
      name: article.name,
      heading: extractFirstHeading(article.contentMd),
      createdAt: article.createdAt,
    }));
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

/**
 * Permanently delete a project and everything in its container: the
 * project's articles, memories, and task list, its sessions — including the delegate
 * children those sessions spawned — and those sessions' messages and
 * articles, in one transaction. An in-code cascade matching the rest of the
 * codebase rather than a schema-level ON DELETE. Deleting an absent project
 * removes nothing.
 */
export function deleteProject(db: KiriDb, id: string): void {
  db.transaction((tx) => {
    const sessionIds = tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.projectId, id))
      .all()
      .map((row) => row.id);
    const childIds =
      sessionIds.length > 0
        ? tx
            .select({ id: sessions.id })
            .from(sessions)
            .where(inArray(sessions.parentSessionId, sessionIds))
            .all()
            .map((row) => row.id)
        : [];
    const allSessionIds = [...childIds, ...sessionIds];
    if (allSessionIds.length > 0) {
      tx.delete(articles).where(inArray(articles.sessionId, allSessionIds)).run();
      tx.delete(messages).where(inArray(messages.sessionId, allSessionIds)).run();
    }
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
    // Children first: they hold an FK to their parent, and foreign_keys is ON.
    if (childIds.length > 0) tx.delete(sessions).where(inArray(sessions.id, childIds)).run();
    if (sessionIds.length > 0) tx.delete(sessions).where(inArray(sessions.id, sessionIds)).run();
    tx.delete(projects).where(eq(projects.id, id)).run();
  });
}
