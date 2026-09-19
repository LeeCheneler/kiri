import { zValidator } from "@hono/zod-validator";
import { and, count, desc, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type * as errorsApi from "../../shared/api/errors.ts";
import type * as memoriesApi from "../../shared/api/memories.ts";
import type { PageQuery } from "../../shared/api/pagination.ts";
import type * as projectsApi from "../../shared/api/projects.ts";
import { deleteArticle, getArticle, listArticleSummaries } from "../articles/store.ts";
import type { KiriDb } from "../db/index.ts";
import { articles, sessions } from "../db/schema.ts";
import type { EventBus } from "../events/index.ts";
import {
  deleteMemory,
  getScopedMemory,
  listProjectMemories,
  memoryNameSchema,
  updateMemory,
} from "../memories/store.ts";
import {
  ProjectConflictError,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from "../projects/store.ts";
import { countOpenTasksByProject } from "../projects/tasks.ts";
import { buildSessionListEntries } from "../sessions/index.ts";
import { projectTasksRoutes } from "./project-tasks.ts";
import { serializeArticleSummary } from "./serializers/articles.ts";
import { serializeMemory, serializeMemorySummary } from "./serializers/memories.ts";
import { serializeProject } from "./serializers/projects.ts";
import { serializeSessionListEntry } from "./serializers/sessions.ts";
import { articleParamSchema, runIdParamSchema as idParamSchema, onZodFail } from "./shared.ts";

const projectBodySchema = z
  .object({ name: z.string().trim().min(1) })
  .strict() satisfies z.ZodType<projectsApi.CreateProjectRequest>;

// A patch carries whichever fields are changing. Instructions may be blank —
// that is how a project's instructions are cleared.
const patchProjectBodySchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    instructions: z.string().optional(),
  })
  .strict() satisfies z.ZodType<projectsApi.PatchProjectRequest>;

const projectMemoryParamSchema = z.object({ id: z.string().min(1), name: memoryNameSchema });

const patchMemoryBodySchema = z
  .object({
    description: z.string().min(1).optional(),
    contentMd: z.string().min(1).optional(),
  })
  .strict() satisfies z.ZodType<memoriesApi.PatchMemoryRequest>;

const DEFAULT_PROJECT_PAGE_LIMIT = 25;
const MAX_PROJECT_PAGE_LIMIT = 100;
const projectPageQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PROJECT_PAGE_LIMIT)
    .default(DEFAULT_PROJECT_PAGE_LIMIT),
}) satisfies z.ZodType<PageQuery>;

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
      createdAt: project.createdAt.toISOString(),
      articleCount: articleCounts.get(project.id) ?? 0,
      sessionCount: sessionCounts.get(project.id) ?? 0,
      openTaskCount: openTaskCounts.get(project.id) ?? 0,
    }));
    return c.json({ projects: rows } satisfies projectsApi.ProjectsResult);
  });

  app.post("/", zValidator("json", projectBodySchema, onZodFail("invalid project")), (c) => {
    const { name } = c.req.valid("json");
    const project = createProject(db, name);
    bus?.publish({ type: "project.created", id: project.id });
    return c.json({ project: serializeProject(project) } satisfies projectsApi.ProjectResult, 201);
  });

  app.get("/:id", zValidator("param", idParamSchema, onZodFail("invalid project id")), (c) => {
    const { id } = c.req.valid("param");
    const project = getProject(db, id);
    if (!project)
      return c.json({ error: `project "${id}" not found` } satisfies errorsApi.ApiErrorBody, 404);
    const rows = projectSessions(db, id);
    return c.json({
      project: serializeProject(project),
      articles: listArticleSummaries(db, { projectId: id }, { newestFirst: true }).map(
        serializeArticleSummary,
      ),
      memories: listProjectMemories(db, id).map(serializeMemorySummary),
      // The full listing projection, so the page renders the same rows as
      // the feed — in scoped dress, so the redundant project link is the
      // display site's decision rather than a hole in the data.
      sessions: buildSessionListEntries(db, rows).map(serializeSessionListEntry),
    } satisfies projectsApi.ProjectDetail);
  });

  app.get(
    "/:id/overview",
    zValidator("param", idParamSchema, onZodFail("invalid project id")),
    (c) => {
      const { id } = c.req.valid("param");
      const project = getProject(db, id);
      if (!project)
        return c.json({ error: `project "${id}" not found` } satisfies errorsApi.ApiErrorBody, 404);
      const articleCount = db
        .select({ count: count() })
        .from(articles)
        .where(eq(articles.projectId, id))
        .get()?.count;
      const sessionCount = db
        .select({ count: count() })
        .from(sessions)
        .where(and(eq(sessions.projectId, id), isNull(sessions.parentSessionId)))
        .get()?.count;
      return c.json({
        project: serializeProject(project),
        memories: listProjectMemories(db, id).map(serializeMemorySummary),
        articleCount: articleCount ?? 0,
        sessionCount: sessionCount ?? 0,
      } satisfies projectsApi.ProjectOverview);
    },
  );

  app.get(
    "/:id/sessions",
    zValidator("param", idParamSchema, onZodFail("invalid project id")),
    zValidator("query", projectPageQuerySchema, onZodFail("invalid project page")),
    (c) => {
      const { id } = c.req.valid("param");
      const { cursor, limit } = c.req.valid("query");
      if (!getProject(db, id))
        return c.json({ error: `project "${id}" not found` } satisfies errorsApi.ApiErrorBody, 404);
      const anchor =
        cursor === undefined
          ? undefined
          : db
              .select({ startedAt: sessions.startedAt, id: sessions.id })
              .from(sessions)
              .where(
                and(
                  eq(sessions.id, cursor),
                  eq(sessions.projectId, id),
                  isNull(sessions.parentSessionId),
                ),
              )
              .get();
      if (cursor !== undefined && !anchor) {
        return c.json(
          { error: `cursor "${cursor}" not found` } satisfies errorsApi.ApiErrorBody,
          400,
        );
      }
      const rows = db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.projectId, id),
            isNull(sessions.parentSessionId),
            anchor
              ? or(
                  lt(sessions.startedAt, anchor.startedAt),
                  and(eq(sessions.startedAt, anchor.startedAt), lt(sessions.id, anchor.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(sessions.startedAt), desc(sessions.id))
        .limit(limit)
        .all();
      return c.json({
        sessions: buildSessionListEntries(db, rows).map(serializeSessionListEntry),
        nextCursor: rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null,
      } satisfies projectsApi.ProjectSessionsPage);
    },
  );

  app.get(
    "/:id/articles",
    zValidator("param", idParamSchema, onZodFail("invalid project id")),
    zValidator("query", projectPageQuerySchema, onZodFail("invalid project page")),
    (c) => {
      const { id } = c.req.valid("param");
      const { cursor, limit } = c.req.valid("query");
      if (!getProject(db, id))
        return c.json({ error: `project "${id}" not found` } satisfies errorsApi.ApiErrorBody, 404);
      const anchor =
        cursor === undefined
          ? undefined
          : db
              .select({ createdAt: articles.createdAt, id: articles.id })
              .from(articles)
              .where(and(eq(articles.id, cursor), eq(articles.projectId, id)))
              .get();
      if (cursor !== undefined && !anchor) {
        return c.json(
          { error: `cursor "${cursor}" not found` } satisfies errorsApi.ApiErrorBody,
          400,
        );
      }
      const rows = db
        .select({
          id: articles.id,
          slug: articles.slug,
          name: articles.name,
          heading: articles.heading,
          createdAt: articles.createdAt,
        })
        .from(articles)
        .where(
          and(
            eq(articles.projectId, id),
            anchor
              ? or(
                  lt(articles.createdAt, anchor.createdAt),
                  and(eq(articles.createdAt, anchor.createdAt), lt(articles.id, anchor.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(articles.createdAt), desc(articles.id))
        .limit(limit)
        .all();
      return c.json({
        articles: rows.map((article) => ({
          slug: article.slug,
          name: article.name,
          heading: article.heading,
          createdAt: article.createdAt.toISOString(),
        })),
        nextCursor: rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null,
      } satisfies projectsApi.ProjectArticlesPage);
    },
  );

  app.patch(
    "/:id",
    zValidator("param", idParamSchema, onZodFail("invalid project id")),
    zValidator("json", patchProjectBodySchema, onZodFail("invalid project")),
    (c) => {
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json");
      if (!getProject(db, id))
        return c.json({ error: `project "${id}" not found` } satisfies errorsApi.ApiErrorBody, 404);
      const project = updateProject(db, id, patch);
      bus?.publish({ type: "project.updated", id });
      return c.json({ project: serializeProject(project) } satisfies projectsApi.ProjectResult);
    },
  );

  app.delete("/:id", zValidator("param", idParamSchema, onZodFail("invalid project id")), (c) => {
    const { id } = c.req.valid("param");
    if (!getProject(db, id))
      return c.json({ error: `project "${id}" not found` } satisfies errorsApi.ApiErrorBody, 404);

    let sessionIds: string[];
    try {
      sessionIds = deleteProject(db, id);
    } catch (cause) {
      if (cause instanceof ProjectConflictError)
        return c.json({ error: cause.message } satisfies errorsApi.ApiErrorBody, 409);
      throw cause;
    }

    // The feed and session caches key off session ids, so each top-level
    // session deleted with the container is announced alongside it.
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
      if (!getProject(db, id))
        return c.json({ error: `project "${id}" not found` } satisfies errorsApi.ApiErrorBody, 404);

      const article = getArticle(db, { projectId: id }, slug);
      if (!article) {
        return c.json(
          {
            error: `article "${slug}" not found on project "${id}"`,
          } satisfies errorsApi.ApiErrorBody,
          404,
        );
      }

      deleteArticle(db, article.id);
      bus?.publish({ type: "article.deleted", projectId: id, slug });

      return c.body(null, 204);
    },
  );

  app.get(
    "/:id/articles/:slug",
    zValidator("param", articleParamSchema, onZodFail("invalid article slug")),
    (c) => {
      const { id, slug } = c.req.valid("param");
      if (!getProject(db, id))
        return c.json({ error: `project "${id}" not found` } satisfies errorsApi.ApiErrorBody, 404);

      const article = getArticle(db, { projectId: id }, slug);
      if (!article) {
        return c.json(
          {
            error: `article "${slug}" not found on project "${id}"`,
          } satisfies errorsApi.ApiErrorBody,
          404,
        );
      }
      return c.json({
        id: article.id,
        projectId: id,
        slug: article.slug,
        name: article.name,
        contentMd: article.contentMd,
        createdAt: article.createdAt.toISOString(),
        heading: article.heading,
      } satisfies projectsApi.ProjectArticleDetail);
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

  app.get(
    "/:id/memories/:name",
    zValidator("param", projectMemoryParamSchema, onZodFail("invalid memory name")),
    (c) => {
      const { id, name } = c.req.valid("param");
      const found = requireProjectMemory(id, name);
      if ("error" in found) return c.json(found satisfies errorsApi.ApiErrorBody, 404);
      return c.json({ memory: serializeMemory(found) } satisfies memoriesApi.MemoryResult);
    },
  );

  app.patch(
    "/:id/memories/:name",
    zValidator("param", projectMemoryParamSchema, onZodFail("invalid memory name")),
    zValidator("json", patchMemoryBodySchema, onZodFail("invalid memory")),
    (c) => {
      const { id, name } = c.req.valid("param");
      const patch = c.req.valid("json");
      const found = requireProjectMemory(id, name);
      if ("error" in found) return c.json(found satisfies errorsApi.ApiErrorBody, 404);

      const updated = updateMemory(db, found.id, patch);
      // An empty patch changed nothing, so there is nothing to announce.
      if (Object.keys(patch).length > 0)
        bus?.publish({ type: "memory.saved", name, projectId: id });

      return c.json({ memory: serializeMemory(updated) } satisfies memoriesApi.MemoryResult);
    },
  );

  app.delete(
    "/:id/memories/:name",
    zValidator("param", projectMemoryParamSchema, onZodFail("invalid memory name")),
    (c) => {
      const { id, name } = c.req.valid("param");
      const found = requireProjectMemory(id, name);
      if ("error" in found) return c.json(found satisfies errorsApi.ApiErrorBody, 404);

      deleteMemory(db, found.id);
      bus?.publish({ type: "memory.deleted", name, projectId: id });

      return c.body(null, 204);
    },
  );

  return app;
}
