import type { ActivityPage, ArticleFeedPage } from "../../shared/api/activity.ts";
import type { PageQuery } from "../../shared/api/pagination.ts";
import { apiFetch, json } from "./http.ts";

/**
 * Fetch one page of the unified activity feed (runs and sessions interleaved),
 * newest first. Pass `cursor` from the previous page's `nextCursor` to advance
 * and `limit` (1–100) to size the page. Throws on non-2xx.
 */
export const fetchActivityPage = async (opts: PageQuery = {}): Promise<ActivityPage> => {
  const params = new URLSearchParams();
  if (opts.cursor !== undefined) params.set("cursor", opts.cursor);
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return json<ActivityPage>(await apiFetch(`/api/activity${qs ? `?${qs}` : ""}`));
};

/**
 * Fetch one page of the articles feed — every article any run, session, or
 * project has written, newest first. Paged like {@link fetchActivityPage}.
 * Throws on non-2xx.
 */
export const fetchArticleFeedPage = async (opts: PageQuery = {}): Promise<ArticleFeedPage> => {
  const params = new URLSearchParams();
  if (opts.cursor !== undefined) params.set("cursor", opts.cursor);
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return json<ArticleFeedPage>(await apiFetch(`/api/activity/articles${qs ? `?${qs}` : ""}`));
};
