import { zValidator } from "@hono/zod-validator";
import { and, asc, count, eq, isNotNull, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { extractFirstHeading } from "../../shared/extract-first-heading.ts";
import type { KiriDb } from "../db/index.ts";
import { articles, sessions } from "../db/schema.ts";
import type { EventBus } from "../events/index.ts";
import {
  createProject,
  deleteProject,
  getProject,
  listProjectArticles,
  listProjects,
  updateProjectName,
} from "../projects/store.ts";
import { getSessionPreviews } from "../sessions/index.ts";
import { articleParamSchema, runIdParamSchema as idParamSchema, onZodFail } from "./shared.ts";

const projectBodySchema = z.object({ name: z.string().trim().min(1) }).strict();

export interface ProjectsRoutesDeps {
  db: KiriDb;
  bus?: EventBus;
}

// A project's top-level sessions, newest first — delegate children stay
// inside their parent's transcript here just as they do on the feed.
const projectSessions = (db: KiriDb, projectId: string) =>
  db
    .select()
    .from(sessions)
    .where(and(eq(sessions.projectId, projectId), isNull(sessions.parentSessionId)))
    .orderBy(asc(sessions.startedAt), asc(sessions.id))
    .all();

/**
 * HTTP surface for projects: list and create containers, read one with its
 * article and session indexes, rename it, and delete it — which cascades the
 * whole container. Every mutation publishes the matching bus event so open
 * views refresh.
 */
export function projectsRoutes(deps: ProjectsRoutesDeps): Hono {
  const { db, bus } = deps;
  const app = new Hono();

  app.get("/", (c) => {
    // Corpus and session sizes, batched across the page in two grouped
    // queries rather than a pair per project.
    const articleCounts = new Map(
      db
        .select({ projectId: articles.projectId, count: count() })
        .from(articles)
        .where(isNotNull(articles.projectId))
        .groupBy(articles.projectId)
        .all()
        .map((row) => [row.projectId, row.count]),
    );
    const sessionCounts = new Map(
      db
        .select({ projectId: sessions.projectId, count: count() })
        .from(sessions)
        .where(and(isNotNull(sessions.projectId), isNull(sessions.parentSessionId)))
        .groupBy(sessions.projectId)
        .all()
        .map((row) => [row.projectId, row.count]),
    );
    const rows = listProjects(db).map((project) => ({
      ...project,
      articleCount: articleCounts.get(project.id) ?? 0,
      sessionCount: sessionCounts.get(project.id) ?? 0,
    }));
    return c.json({ projects: rows });
  });

  app.post("/", zValidator("json", projectBodySchema, onZodFail("invalid project")), (c) => {
    const { name } = c.req.valid("json");
    const project = createProject(db, name);
    bus?.publish({ type: "project.created", id: project.id });
    return c.json({ project }, 201);
  });

  app.get("/:id", zValidator("param", idParamSchema, onZodFail("invalid project id")), (c) => {
    const { id } = c.req.valid("param");
    const project = getProject(db, id);
    if (!project) return c.json({ error: `project "${id}" not found` }, 404);
    const rows = projectSessions(db, id);
    const previews = getSessionPreviews(
      db,
      rows.map((row) => row.id),
    );
    return c.json({
      project,
      articles: listProjectArticles(db, id),
      sessions: rows.map((row) => ({
        id: row.id,
        title: row.title,
        preview: previews.get(row.id) ?? null,
        status: row.status,
        startedAt: row.startedAt,
      })),
    });
  });

  app.patch(
    "/:id",
    zValidator("param", idParamSchema, onZodFail("invalid project id")),
    zValidator("json", projectBodySchema, onZodFail("invalid project")),
    (c) => {
      const { id } = c.req.valid("param");
      const { name } = c.req.valid("json");
      if (!getProject(db, id)) return c.json({ error: `project "${id}" not found` }, 404);
      const project = updateProjectName(db, id, name);
      bus?.publish({ type: "project.updated", id });
      return c.json({ project });
    },
  );

  app.delete("/:id", zValidator("param", idParamSchema, onZodFail("invalid project id")), (c) => {
    const { id } = c.req.valid("param");
    if (!getProject(db, id)) return c.json({ error: `project "${id}" not found` }, 404);
    // Snapshot the top-level session ids before the cascade so their
    // deletions can be announced — the feed and session caches key off them.
    const sessionIds = projectSessions(db, id).map((row) => row.id);
    deleteProject(db, id);
    bus?.publish({ type: "project.deleted", id });
    for (const sessionId of sessionIds) {
      bus?.publish({ type: "session.deleted", id: sessionId });
    }
    return c.body(null, 204);
  });

  app.get(
    "/:id/articles/:slug",
    zValidator("param", articleParamSchema, onZodFail("invalid article slug")),
    (c) => {
      const { id, slug } = c.req.valid("param");
      if (!getProject(db, id)) return c.json({ error: `project "${id}" not found` }, 404);
      const article = db
        .select()
        .from(articles)
        .where(and(eq(articles.projectId, id), eq(articles.slug, slug)))
        .get();
      if (!article) {
        return c.json({ error: `article "${slug}" not found on project "${id}"` }, 404);
      }
      return c.json({
        id: article.id,
        projectId: article.projectId,
        slug: article.slug,
        name: article.name,
        contentMd: article.contentMd,
        createdAt: article.createdAt,
        heading: extractFirstHeading(article.contentMd),
      });
    },
  );

  return app;
}
