import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { KiriDb } from "../db/index.ts";
import { articles, runs } from "../db/schema.ts";

export interface ArticlesRoutesDeps {
  db: KiriDb;
}

// Size of the cross-run "recently published" list. Fixed — the rail
// surfaces a glance-able shortlist, not a paginated archive.
const RECENT_ARTICLES_LIMIT = 5;

/**
 * Build the Hono sub-app for `/api/articles/*`: the right-rail
 * "recently published" feed across all runs. Mounted at
 * `/api/articles` by `createApp`.
 */
export function articlesRoutes(deps: ArticlesRoutesDeps): Hono {
  const { db } = deps;
  const app = new Hono();

  app.get("/recent", (c) => {
    // The articles table doesn't carry the workflow name, so join runs to
    // surface it alongside each entry. `content_md` is omitted — the rail
    // only needs link metadata; the body is fetched by the article page.
    const rows = db
      .select({
        runId: articles.runId,
        name: articles.name,
        title: articles.title,
        createdAt: articles.createdAt,
        workflowName: runs.workflowName,
      })
      .from(articles)
      .innerJoin(runs, eq(runs.id, articles.runId))
      .orderBy(desc(articles.createdAt))
      .limit(RECENT_ARTICLES_LIMIT)
      .all();
    return c.json(rows);
  });

  return app;
}
