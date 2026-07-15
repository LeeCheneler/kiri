import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { KiriDb } from "../db/index.ts";
import { search } from "../search/search.ts";
import type { Registry } from "../workflows/index.ts";
import { onZodFail } from "./shared.ts";

export interface SearchRoutesDeps {
  db: KiriDb;
  registry: Registry;
}

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;

// `q` is required but may be blank: the overlay queries as the user types,
// and a blank box legitimately means "no results yet", not a client error.
const searchQuerySchema = z.object({
  q: z.string(),
  limit: z.coerce.number().int().min(1).max(MAX_SEARCH_LIMIT).default(DEFAULT_SEARCH_LIMIT),
});

/**
 * Build the Hono sub-app for `/api/search`: the cross-entity search endpoint
 * backing the search overlay. Mounted at `/api/search` by `createApp`.
 */
export function searchRoutes(deps: SearchRoutesDeps): Hono {
  const app = new Hono();

  app.get("/", zValidator("query", searchQuerySchema, onZodFail("invalid search query")), (c) => {
    const { q, limit } = c.req.valid("query");
    return c.json(search(deps, q, limit));
  });

  return app;
}
