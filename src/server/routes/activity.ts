import { zValidator } from "@hono/zod-validator";
import { and, asc, count, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { extractFirstHeading } from "../../shared/extract-first-heading.ts";
import type { KiriDb } from "../db/index.ts";
import { articles, recommendations, runs, sessions } from "../db/schema.ts";
import { getSessionPreviews } from "../sessions/index.ts";
import type { Registry } from "../workflows/index.ts";
import { onZodFail } from "./shared.ts";

export interface ActivityRoutesDeps {
  db: KiriDb;
  registry: Registry;
}

const DEFAULT_ACTIVITY_LIMIT = 25;
const MAX_ACTIVITY_LIMIT = 100;

const activityListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_ACTIVITY_LIMIT).default(DEFAULT_ACTIVITY_LIMIT),
});

// The activity cursor carries the whole sort key — (started_at epoch ms, id) —
// base64url-encoded into one opaque token. The per-table feeds cursor on a bare
// id, but here an id can't say whether it belongs to a run or a session, so the
// key rides the cursor itself and paging needs no anchor lookup.
const encodeCursor = (startedAt: Date, id: string): string =>
  Buffer.from(`${startedAt.getTime()}:${id}`).toString("base64url");

const decodeCursor = (raw: string): { startedAt: Date; id: string } | undefined => {
  const decoded = Buffer.from(raw, "base64url").toString();
  const sep = decoded.indexOf(":");
  if (sep === -1) return undefined;
  const ms = Number(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (!Number.isInteger(ms) || id === "") return undefined;
  return { startedAt: new Date(ms), id };
};

type ArticleProjection = {
  slug: string;
  name: string;
  heading: string | null;
  createdAt: Date;
};

// Assemble the feed shape for a page of runs — the base row plus its produced
// articles and a recommendation count, both batched across the page — keyed by
// id so each run can be slotted back into the merged activity order. Mirrors the
// per-run-feed assembly in the runs route.
function buildRunEntries(db: KiriDb, registry: Registry, rows: Array<typeof runs.$inferSelect>) {
  // Key widened to `string | null` to match `articles.runId`'s nullable
  // type; the `inArray` filter below means only this page's run ids appear.
  const articlesByRunId = new Map<string | null, ArticleProjection[]>();
  const recommendationCountByRunId = new Map<string, number>();
  if (rows.length > 0) {
    const runIds = rows.map((r) => r.id);
    const allArticles = db
      .select({
        runId: articles.runId,
        slug: articles.slug,
        name: articles.name,
        contentMd: articles.contentMd,
        createdAt: articles.createdAt,
      })
      .from(articles)
      .where(inArray(articles.runId, runIds))
      .orderBy(asc(articles.createdAt))
      .all();
    for (const { runId, slug, name, contentMd, createdAt } of allArticles) {
      const entry: ArticleProjection = {
        slug,
        name,
        heading: extractFirstHeading(contentMd),
        createdAt,
      };
      const list = articlesByRunId.get(runId);
      if (list) list.push(entry);
      else articlesByRunId.set(runId, [entry]);
    }
    const recCounts = db
      .select({ runId: recommendations.runId, count: count() })
      .from(recommendations)
      .where(inArray(recommendations.runId, runIds))
      .groupBy(recommendations.runId)
      .all();
    for (const { runId, count: n } of recCounts) recommendationCountByRunId.set(runId, n);
  }

  const entries = rows.map((row) => ({
    ...row,
    isInterrupted: !registry.getWorkflow(row.workflowName),
    articles: articlesByRunId.get(row.id) ?? [],
    recommendationsCount: recommendationCountByRunId.get(row.id) ?? 0,
  }));
  return new Map(entries.map((e) => [e.id, e] as const));
}

/**
 * Build the Hono sub-app for `/api/activity`: the unified, cursor-paginated
 * activity feed — workflow runs and sessions interleaved newest-first by start
 * time. Mounted at `/api/activity` by `createApp`, always present (the sessions
 * table exists regardless of whether the LLM surface is configured, so its arm
 * is simply empty when no sessions exist).
 */
export function activityRoutes(deps: ActivityRoutesDeps): Hono {
  const { db, registry } = deps;
  const app = new Hono();

  app.get("/", zValidator("query", activityListQuerySchema, onZodFail("invalid query")), (c) => {
    const { cursor, limit } = c.req.valid("query");

    let anchor: { startedAt: Date; id: string } | undefined;
    if (cursor !== undefined) {
      anchor = decodeCursor(cursor);
      if (!anchor) return c.json({ error: `invalid cursor "${cursor}"` }, 400);
    }

    // Each arm returns its own newest `limit` rows after the cursor, in
    // (started_at DESC, id DESC) order. The global newest `limit` of the union
    // is guaranteed to live within each arm's newest `limit`, so merging the
    // two and slicing to `limit` yields the exact page.
    const runRows = db
      .select()
      .from(runs)
      .where(
        anchor
          ? or(
              lt(runs.startedAt, anchor.startedAt),
              and(eq(runs.startedAt, anchor.startedAt), lt(runs.id, anchor.id)),
            )
          : undefined,
      )
      .orderBy(desc(runs.startedAt), desc(runs.id))
      .limit(limit)
      .all();

    // Child sessions never appear in the feed — only top-level sessions.
    const topLevelSessions = isNull(sessions.parentSessionId);
    const sessionRows = db
      .select()
      .from(sessions)
      .where(
        anchor
          ? and(
              topLevelSessions,
              or(
                lt(sessions.startedAt, anchor.startedAt),
                and(eq(sessions.startedAt, anchor.startedAt), lt(sessions.id, anchor.id)),
              ),
            )
          : topLevelSessions,
      )
      .orderBy(desc(sessions.startedAt), desc(sessions.id))
      .limit(limit)
      .all();

    type Tagged =
      | { kind: "run"; row: (typeof runRows)[number] }
      | { kind: "session"; row: (typeof sessionRows)[number] };
    const merged: Tagged[] = [
      ...runRows.map((row) => ({ kind: "run" as const, row })),
      ...sessionRows.map((row) => ({ kind: "session" as const, row })),
    ];
    merged.sort((a, b) => {
      const byTime = b.row.startedAt.getTime() - a.row.startedAt.getTime();
      if (byTime !== 0) return byTime;
      // Tie-break by id DESC, matching each arm's ORDER BY and the keyset cursor.
      return a.row.id < b.row.id ? 1 : a.row.id > b.row.id ? -1 : 0;
    });
    const page = merged.slice(0, limit);

    // A full page means an arm may still hold rows past the boundary, so emit a
    // cursor (mirroring the per-table feeds — a final exactly-full page yields
    // one empty follow-up fetch). A short page means both arms are drained.
    const last = page[page.length - 1];
    const nextCursor =
      page.length === limit && last ? encodeCursor(last.row.startedAt, last.row.id) : null;

    // Enrich each kind only for the ids that survived into the page.
    const runEntryById = buildRunEntries(
      db,
      registry,
      page.flatMap((e) => (e.kind === "run" ? [e.row] : [])),
    );
    const sessionIds = page.flatMap((e) => (e.kind === "session" ? [e.row.id] : []));
    const previews = getSessionPreviews(db, sessionIds);

    // Session articles, batched across the page — the same projection a run
    // entry carries, so both kinds of row lead with what they produced.
    const articlesBySessionId = new Map<string | null, ArticleProjection[]>();
    if (sessionIds.length > 0) {
      const sessionArticles = db
        .select({
          sessionId: articles.sessionId,
          slug: articles.slug,
          name: articles.name,
          contentMd: articles.contentMd,
          createdAt: articles.createdAt,
        })
        .from(articles)
        .where(inArray(articles.sessionId, sessionIds))
        .orderBy(asc(articles.createdAt))
        .all();
      for (const { sessionId, slug, name, contentMd, createdAt } of sessionArticles) {
        const entry: ArticleProjection = {
          slug,
          name,
          heading: extractFirstHeading(contentMd),
          createdAt,
        };
        const list = articlesBySessionId.get(sessionId);
        if (list) list.push(entry);
        else articlesBySessionId.set(sessionId, [entry]);
      }
    }

    const entries = page.map((e) => {
      if (e.kind === "run") {
        const run = runEntryById.get(e.row.id);
        if (!run) throw new Error(`run "${e.row.id}" vanished during activity assembly`);
        return { kind: "run" as const, run };
      }
      return {
        kind: "session" as const,
        session: {
          ...e.row,
          preview: previews.get(e.row.id) ?? null,
          articles: articlesBySessionId.get(e.row.id) ?? [],
        },
      };
    });

    return c.json({ entries, nextCursor });
  });

  return app;
}
