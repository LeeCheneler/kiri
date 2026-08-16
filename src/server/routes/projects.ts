import { zValidator } from "@hono/zod-validator";
import { and, count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { extractFirstHeading } from "../../shared/extract-first-heading.ts";
import type { KiriDb } from "../db/index.ts";
import { articles, memories, sessions } from "../db/schema.ts";
import type { EventBus } from "../events/index.ts";
import {
  createProject,
  deleteProject,
  getProject,
  listProjectArticles,
  listProjects,
  updateProject,
} from "../projects/store.ts";
import { countOpenTasksByProject } from "../projects/tasks.ts";
import {
  getScopedMemory,
  getSessionPreviews,
  listProjectMemories,
  memoryNameSchema,
} from "../sessions/index.ts";
import { projectTasksRoutes } from "./project-tasks.ts";
import { articleParamSchema, runIdParamSchema as idParamSchema, onZodFail } from "./shared.ts";

const projectBodySchema = z.object({ name: z.string().trim().min(1) }).strict();

// A patch carries whichever fields are changing. Instructions may be blank —
// that is how a project's instructions are cleared.
const patchProjectBodySchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    instructions: z.string().optional(),
  })
  .strict();

const projectMemoryParamSchema = z.object({ id: z.string().min(1), name: memoryNameSchema });

const patchMemoryBodySchema = z
  .object({
    description: z.string().min(1).optional(),
    contentMd: z.string().min(1).optional(),
  })
  .strict();

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
    .orderBy(desc(sessions.startedAt), desc(sessions.id))
    .all();

/**
 * HTTP surface for projects: list and create containers, read one with its
 * article and session indexes, patch its name or standing instructions, and
 * delete it — which cascades the whole container. Each project's task list
 * rides along under the same prefix (see `projectTasksRoutes`). Every mutation publishes the
 * matching bus event so open views refresh.
 */
export function projectsRoutes(deps: ProjectsRoutesDeps): Hono {
  const { db, bus } = deps;
  const app = new Hono();
  app.route("/", projectTasksRoutes(deps));

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
    const openTaskCounts = countOpenTasksByProject(db);
    // The index carries the container's identity and sizes only — a project's
    // instructions can run long and belong to its own page.
    const rows = listProjects(db).map((project) => ({
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      articleCount: articleCounts.get(project.id) ?? 0,
      sessionCount: sessionCounts.get(project.id) ?? 0,
      openTaskCount: openTaskCounts.get(project.id) ?? 0,
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
      memories: listProjectMemories(db, id),
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
    zValidator("json", patchProjectBodySchema, onZodFail("invalid project")),
    (c) => {
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json");
      if (!getProject(db, id)) return c.json({ error: `project "${id}" not found` }, 404);
      const project = updateProject(db, id, patch);
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

  app.delete(
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
      db.delete(articles).where(eq(articles.id, article.id)).run();
      bus?.publish({ type: "article.deleted", projectId: id, slug });
      return c.body(null, 204);
    },
  );

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

  // A project's memories mirror the global curation surface, addressed under
  // their owning project: names are unique per scope, so the same name can
  // exist globally and in any number of projects.
  const requireProjectMemory = (projectId: string, name: string) =>
    getProject(db, projectId) === undefined
      ? { error: `project "${projectId}" not found` }
      : (getScopedMemory(db, projectId, name) ?? {
          error: `memory "${name}" not found on project "${projectId}"`,
        });

  const memoryBody = (memory: NonNullable<ReturnType<typeof getScopedMemory>>) => ({
    memory: {
      name: memory.name,
      description: memory.description,
      contentMd: memory.contentMd,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
    },
  });

  app.get(
    "/:id/memories/:name",
    zValidator("param", projectMemoryParamSchema, onZodFail("invalid memory name")),
    (c) => {
      const { id, name } = c.req.valid("param");
      const found = requireProjectMemory(id, name);
      if ("error" in found) return c.json(found, 404);
      return c.json(memoryBody(found));
    },
  );

  app.patch(
    "/:id/memories/:name",
    zValidator("param", projectMemoryParamSchema, onZodFail("invalid memory name")),
    zValidator("json", patchMemoryBodySchema, onZodFail("invalid memory")),
    (c) => {
      const { id, name } = c.req.valid("param");
      const { description, contentMd } = c.req.valid("json");
      const found = requireProjectMemory(id, name);
      if ("error" in found) return c.json(found, 404);
      if (description !== undefined || contentMd !== undefined) {
        db.update(memories)
          .set({
            ...(description !== undefined ? { description } : {}),
            ...(contentMd !== undefined ? { contentMd: contentMd.trimEnd() } : {}),
            updatedAt: new Date(),
          })
          .where(eq(memories.id, found.id))
          .run();
        bus?.publish({ type: "memory.saved", name, projectId: id });
      }
      return c.json(memoryBody(getScopedMemory(db, id, name) as typeof found));
    },
  );

  app.delete(
    "/:id/memories/:name",
    zValidator("param", projectMemoryParamSchema, onZodFail("invalid memory name")),
    (c) => {
      const { id, name } = c.req.valid("param");
      const found = requireProjectMemory(id, name);
      if ("error" in found) return c.json(found, 404);
      db.delete(memories).where(eq(memories.id, found.id)).run();
      bus?.publish({ type: "memory.deleted", name, projectId: id });
      return c.body(null, 204);
    },
  );

  return app;
}
