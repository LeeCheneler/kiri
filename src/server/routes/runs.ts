import { rmSync } from "node:fs";
import { join } from "node:path";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, desc, eq, inArray, lt, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";
import { z } from "zod";
import { extractFirstHeading } from "../../shared/extract-first-heading.ts";
import type { KiriDb } from "../db/index.ts";
import { articles, recommendations, runSteps, runs } from "../db/schema.ts";
import type { EventBus } from "../events/index.ts";
import type { CancelRegistry } from "../runner/cancel-registry.ts";
import { runWorkflow } from "../runner/index.ts";
import { type Registry, buildInputSchema } from "../workflows/index.ts";
import {
  onZodFail,
  optionalInvokeBody,
  publishedArticleParamSchema,
  runIdParamSchema,
  zodErrorBody,
} from "./shared.ts";

export interface RunsRoutesDeps {
  db: KiriDb;
  registry: Registry;
  cwd: string;
  bus?: EventBus;
  /**
   * When supplied, in-flight runs are reachable via
   * `POST /api/runs/:id/cancel`. Omit to leave the cancel route
   * unmounted entirely.
   */
  cancelRegistry?: CancelRegistry;
}

const DEFAULT_RUN_LIMIT = 25;
const MAX_RUN_LIMIT = 100;

const runListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_RUN_LIMIT).default(DEFAULT_RUN_LIMIT),
  workflow: z.string().min(1).optional(),
});

const recommendationActionParamSchema = z.object({
  runId: z.string().min(1),
  recId: z.string().min(1),
});

/**
 * Build the Hono sub-app for `/api/runs/*`: paginated list, detail
 * fetch, delete, rerun, optional cancel, and the per-run published-article
 * fetch. Mounted at `/api/runs` by `createApp`.
 */
export function runsRoutes(deps: RunsRoutesDeps): Hono {
  const { db, registry, cwd, bus, cancelRegistry } = deps;
  const app = new Hono();

  app.get("/", zValidator("query", runListQuerySchema, onZodFail("invalid query")), (c) => {
    const { cursor, limit, workflow } = c.req.valid("query");

    // Keyset pagination on the compound key (started_at DESC, id DESC). The
    // cursor is the last seen run's id; we look it up to resolve its
    // started_at and then page strictly after that point.
    let anchor: { startedAt: Date; id: string } | undefined;
    if (cursor !== undefined) {
      const found = db
        .select({ startedAt: runs.startedAt, id: runs.id })
        .from(runs)
        .where(eq(runs.id, cursor))
        .get();
      if (!found) return c.json({ error: `cursor "${cursor}" not found` }, 400);
      anchor = found;
    }

    // An unknown `workflow` simply matches no rows — an empty page is the
    // right answer, not a 4xx, so the equality filter handles it for free.
    const rows = db
      .select()
      .from(runs)
      .where(
        and(
          workflow !== undefined ? eq(runs.workflowName, workflow) : undefined,
          anchor
            ? or(
                lt(runs.startedAt, anchor.startedAt),
                and(eq(runs.startedAt, anchor.startedAt), lt(runs.id, anchor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(runs.startedAt), desc(runs.id))
      .limit(limit)
      .all();

    const nextCursor = rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null;

    // Single aggregation across the page rather than per-row N+1. Empty page
    // skips the query entirely so the common no-articles feed pays nothing.
    // `content_md` is pulled to derive each entry's first-h1 byline but not
    // echoed back — the body itself is fetched by the article page.
    type ArticleProjection = {
      name: string;
      title: string;
      heading: string | null;
      createdAt: Date;
    };
    const articlesByRunId = new Map<string, ArticleProjection[]>();
    const recommendationCountByRunId = new Map<string, number>();
    if (rows.length > 0) {
      const runIds = rows.map((r) => r.id);
      const allArticles = db
        .select({
          runId: articles.runId,
          name: articles.name,
          title: articles.title,
          contentMd: articles.contentMd,
          createdAt: articles.createdAt,
        })
        .from(articles)
        .where(inArray(articles.runId, runIds))
        .orderBy(asc(articles.createdAt))
        .all();
      for (const { runId, name, title, contentMd, createdAt } of allArticles) {
        const list = articlesByRunId.get(runId);
        const entry: ArticleProjection = {
          name,
          title,
          heading: extractFirstHeading(contentMd),
          createdAt,
        };
        if (list) list.push(entry);
        else articlesByRunId.set(runId, [entry]);
      }
      // Single grouped count across the page; runs with no recs are simply
      // absent from the map and fall back to 0 below.
      const recCounts = db
        .select({ runId: recommendations.runId, count: count() })
        .from(recommendations)
        .where(inArray(recommendations.runId, runIds))
        .groupBy(recommendations.runId)
        .all();
      for (const { runId, count: n } of recCounts) {
        recommendationCountByRunId.set(runId, n);
      }
    }

    return c.json({
      runs: rows.map((row) => ({
        ...row,
        isInterrupted: !registry.getWorkflow(row.workflowName),
        articles: articlesByRunId.get(row.id) ?? [],
        recommendationsCount: recommendationCountByRunId.get(row.id) ?? 0,
      })),
      nextCursor,
    });
  });

  app.get(
    "/:id/published/:name",
    zValidator("param", publishedArticleParamSchema, onZodFail("invalid article name")),
    (c) => {
      const { id, name } = c.req.valid("param");
      const run = db.select().from(runs).where(eq(runs.id, id)).get();
      if (!run) return c.json({ error: `run "${id}" not found` }, 404);
      const article = db
        .select()
        .from(articles)
        .where(and(eq(articles.runId, id), eq(articles.name, name)))
        .get();
      if (!article) {
        return c.json({ error: `article "${name}" not found on run "${id}"` }, 404);
      }
      return c.json({
        id: article.id,
        runId: article.runId,
        name: article.name,
        title: article.title,
        contentMd: article.contentMd,
        createdAt: article.createdAt,
        workflowName: run.workflowName,
        heading: extractFirstHeading(article.contentMd),
        gitSha: run.gitSha,
        gitDirty: run.gitDirty,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
      });
    },
  );

  app.get("/:id", zValidator("param", runIdParamSchema, onZodFail("invalid run id")), (c) => {
    const { id } = c.req.valid("param");
    const run = db.select().from(runs).where(eq(runs.id, id)).get();
    if (!run) return c.json({ error: `run "${id}" not found` }, 404);
    // Publish and summary rows ship alongside pipeline steps; clients
    // separate them by the `isPublish` / `isSummary` flags. This is what
    // lets the run detail page render in-flight publish indicators while
    // an article row hasn't yet been written.
    const steps = db
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, id))
      .orderBy(asc(runSteps.index))
      .all();
    // `content_md` is deliberately omitted — the article body is fetched
    // by the dedicated article page so the run-detail payload stays small.
    // Lives on `run.articles` so every RunListEntry — list or detail —
    // shares the same shape; chip rendering and the published-section row
    // both read from one place.
    const articleRows = db
      .select({
        name: articles.name,
        title: articles.title,
        contentMd: articles.contentMd,
        createdAt: articles.createdAt,
      })
      .from(articles)
      .where(eq(articles.runId, id))
      .orderBy(asc(articles.createdAt))
      .all()
      .map(({ contentMd, ...row }) => ({
        ...row,
        heading: extractFirstHeading(contentMd),
      }));
    // Self-join `runs` aliased to the actioned target so a triggered
    // recommendation ships the destination run's status with it — the UI
    // renders it as a status-badged link without a follow-up round-trip.
    // Untriggered rows leave `actionedRunStatus` null via the left join.
    const actionedRuns = alias(runs, "actioned_runs");
    const recommendationRows = db
      .select({
        id: recommendations.id,
        index: recommendations.index,
        title: recommendations.title,
        description: recommendations.description,
        workflow: recommendations.workflow,
        inputs: recommendations.inputs,
        actionedRunId: recommendations.actionedRunId,
        actionedAt: recommendations.actionedAt,
        actionedRunStatus: actionedRuns.status,
      })
      .from(recommendations)
      .leftJoin(actionedRuns, eq(recommendations.actionedRunId, actionedRuns.id))
      .where(eq(recommendations.runId, id))
      .orderBy(asc(recommendations.index))
      .all();
    return c.json({
      run: {
        ...run,
        isInterrupted: !registry.getWorkflow(run.workflowName),
        articles: articleRows,
        // Shared with the feed-list shape; derived for free from the rows we
        // already fetched, no second query.
        recommendationsCount: recommendationRows.length,
        recommendations: recommendationRows,
      },
      steps,
    });
  });

  app.delete("/:id", zValidator("param", runIdParamSchema, onZodFail("invalid run id")), (c) => {
    const { id } = c.req.valid("param");
    const run = db.select().from(runs).where(eq(runs.id, id)).get();
    if (!run) return c.json({ error: `run "${id}" not found` }, 404);
    if (run.status === "running") {
      return c.json({ error: `run "${id}" is in flight; cancel it first` }, 409);
    }
    // Explicit cascade in a transaction: articles, step rows, and
    // recommendations all hold FKs to the parent run, so they go first.
    // Inbound `actionedRunId` references from other runs' recs are
    // nulled (with `actionedAt`) so those recs flip back to triggerable
    // — same row, link cleared. Matches the rest of the codebase's
    // pattern of in-code cascades instead of schema-level ON DELETE.
    db.transaction((tx) => {
      tx.delete(articles).where(eq(articles.runId, id)).run();
      tx.delete(runSteps).where(eq(runSteps.runId, id)).run();
      tx.delete(recommendations).where(eq(recommendations.runId, id)).run();
      tx.update(recommendations)
        .set({ actionedRunId: null, actionedAt: null })
        .where(eq(recommendations.actionedRunId, id))
        .run();
      tx.delete(runs).where(eq(runs.id, id)).run();
    });
    // Catches scratch-dir leftovers from a crashed runner; on a normal
    // run the dir is already gone, and `force: true` makes that a no-op.
    rmSync(join(cwd, ".kiri", "runs", id), { recursive: true, force: true });
    bus?.publish({ type: "run.deleted", id });
    return c.body(null, 204);
  });

  app.post(
    "/:id/rerun",
    zValidator("param", runIdParamSchema, onZodFail("invalid run id")),
    optionalInvokeBody,
    async (c) => {
      const { id } = c.req.valid("param");
      const run = db.select().from(runs).where(eq(runs.id, id)).get();
      if (!run) return c.json({ error: `run "${id}" not found` }, 404);
      if (run.status === "running") {
        return c.json({ error: `run "${id}" is in flight; cancel it first` }, 409);
      }
      const wf = registry.getWorkflow(run.workflowName);
      if (!wf) {
        return c.json(
          { error: `workflow "${run.workflowName}" no longer exists; re-create it first` },
          409,
        );
      }

      const { inputs = {} } = c.get("invokeBody");
      const check = buildInputSchema(wf).safeParse(inputs);
      if (!check.success) return c.json(zodErrorBody(check.error, "invalid inputs"), 400);

      // Cascade-wipe articles, step rows, and the rerun's own
      // recommendations (mirrors the delete path, minus the final `runs`
      // delete) so the rerun starts with a clean slate under the same
      // run id. Inbound `actionedRunId` references from other runs are
      // deliberately left intact: the id persists, so the link still
      // resolves to a real run — same as everywhere else. Scratch dir
      // is removed too — normally already gone, but a crashed runner
      // can leave it behind.
      db.transaction((tx) => {
        tx.delete(articles).where(eq(articles.runId, id)).run();
        tx.delete(runSteps).where(eq(runSteps.runId, id)).run();
        tx.delete(recommendations).where(eq(recommendations.runId, id)).run();
      });
      rmSync(join(cwd, ".kiri", "runs", id), { recursive: true, force: true });
      const { done } = runWorkflow(db, wf, {
        cwd,
        bus,
        cancelRegistry,
        runId: id,
        inputs,
      });
      done.catch((cause) => {
        console.error(`run ${id} crashed: ${cause instanceof Error ? cause.message : cause}`);
      });
      return c.json({ runId: id, status: "running" }, 202);
    },
  );

  app.post(
    "/:runId/recommendations/:recId/action",
    zValidator("param", recommendationActionParamSchema, onZodFail("invalid recommendation id")),
    optionalInvokeBody,
    async (c) => {
      const { runId, recId } = c.req.valid("param");
      const rec = db
        .select()
        .from(recommendations)
        .where(and(eq(recommendations.id, recId), eq(recommendations.runId, runId)))
        .get();
      if (!rec) {
        return c.json({ error: `recommendation "${recId}" not found on run "${runId}"` }, 404);
      }
      if (rec.actionedRunId !== null) {
        return c.json({ error: `recommendation "${recId}" has already been actioned` }, 409);
      }
      const wf = registry.getWorkflow(rec.workflow);
      if (!wf) {
        return c.json(
          { error: `workflow "${rec.workflow}" no longer exists; re-create it first` },
          409,
        );
      }

      const { inputs = {} } = c.get("invokeBody");
      const check = buildInputSchema(wf).safeParse(inputs);
      if (!check.success) return c.json(zodErrorBody(check.error, "invalid inputs"), 400);

      const { runId: actionedRunId, done } = runWorkflow(db, wf, {
        cwd,
        bus,
        cancelRegistry,
        inputs,
      });
      done.catch((cause) => {
        console.error(
          `run ${actionedRunId} crashed: ${cause instanceof Error ? cause.message : cause}`,
        );
      });
      db.update(recommendations)
        .set({ actionedRunId, actionedAt: new Date() })
        .where(eq(recommendations.id, recId))
        .run();
      bus?.publish({
        type: "recommendation.actioned",
        runId,
        recommendationId: recId,
        actionedRunId,
      });
      return c.json({ runId: actionedRunId, status: "running" }, 202);
    },
  );

  if (cancelRegistry) {
    app.post(
      "/:id/cancel",
      zValidator("param", runIdParamSchema, onZodFail("invalid run id")),
      (c) => {
        const { id } = c.req.valid("param");
        const run = db.select().from(runs).where(eq(runs.id, id)).get();
        if (!run) return c.json({ error: `run "${id}" not found` }, 404);
        if (run.status !== "running") {
          return c.json({ error: `run "${id}" is not in flight` }, 409);
        }
        // requestCancel returns false only if the registry has no entry — i.e.
        // the runner already released it in the small window between our DB
        // read above and this call. Treat as already-terminal.
        if (!cancelRegistry.requestCancel(id)) {
          return c.json({ error: `run "${id}" is not in flight` }, 409);
        }
        return c.json({ runId: id }, 202);
      },
    );
  }

  return app;
}
