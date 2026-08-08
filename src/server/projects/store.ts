import { asc, desc, eq, inArray } from "drizzle-orm";
import { extractFirstHeading } from "../../shared/extract-first-heading.ts";
import type { KiriDb } from "../db/index.ts";
import { articles, messages, projects, sessions } from "../db/schema.ts";

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
 * A project's article index, oldest first. The body is read only to derive
 * each entry's heading, never returned — detail surfaces serve it.
 */
export function listProjectArticles(db: KiriDb, projectId: string): ProjectArticleSummary[] {
  return db
    .select()
    .from(articles)
    .where(eq(articles.projectId, projectId))
    .orderBy(asc(articles.createdAt))
    .all()
    .map((article) => ({
      slug: article.slug,
      name: article.name,
      heading: extractFirstHeading(article.contentMd),
      createdAt: article.createdAt,
    }));
}

/** Rename a project. A display change only — nothing keys off the name. Returns the updated row. */
export function updateProjectName(db: KiriDb, id: string, name: string): Project {
  db.update(projects).set({ name }).where(eq(projects.id, id)).run();
  return getProject(db, id) as Project;
}

/**
 * Permanently delete a project and everything in its container: the
 * project's articles, its sessions — including the delegate children those
 * sessions spawned — and those sessions' messages and articles, in one
 * transaction. An in-code cascade matching the rest of the codebase rather
 * than a schema-level ON DELETE. Deleting an absent project removes nothing.
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
    // Children first: they hold an FK to their parent, and foreign_keys is ON.
    if (childIds.length > 0) tx.delete(sessions).where(inArray(sessions.id, childIds)).run();
    if (sessionIds.length > 0) tx.delete(sessions).where(inArray(sessions.id, sessionIds)).run();
    tx.delete(projects).where(eq(projects.id, id)).run();
  });
}
