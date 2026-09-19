import type {
  ArticleDetail,
  ArticlesResult,
  SessionArticleDetail,
} from "../../shared/api/articles.ts";
import { apiFetch, assertOk, json } from "./http.ts";

/**
 * Fetch a single article by run id and slug. Throws on
 * non-2xx — 400 for a malformed slug, 404 when either the run or the
 * named article is missing.
 */
export const fetchArticle = async (runId: string, slug: string): Promise<ArticleDetail> =>
  json<ArticleDetail>(
    await apiFetch(`/api/runs/${encodeURIComponent(runId)}/articles/${encodeURIComponent(slug)}`),
  );

/**
 * Fetch a single session-produced article by session id and slug. Throws on
 * non-2xx — 400 for a malformed slug, 404 when either the session or the
 * named article is missing.
 */
export const fetchSessionArticle = async (
  sessionId: string,
  slug: string,
): Promise<SessionArticleDetail> =>
  json<SessionArticleDetail>(
    await apiFetch(
      `/api/sessions/${encodeURIComponent(sessionId)}/articles/${encodeURIComponent(slug)}`,
    ),
  );

/**
 * Delete a session-owned article permanently. Throws `ApiError` on non-2xx
 * (404 when the session or article is missing).
 */
export const deleteSessionArticle = async (sessionId: string, slug: string): Promise<void> => {
  await assertOk(
    await apiFetch(
      `/api/sessions/${encodeURIComponent(sessionId)}/articles/${encodeURIComponent(slug)}`,
      { method: "DELETE" },
    ),
  );
};

/**
 * Fetch the articles a session has written — summary metadata only, oldest
 * first; bodies live on the article detail route. Throws on non-2xx (404
 * when the session doesn't exist).
 */
export const fetchSessionArticles = async (sessionId: string): Promise<ArticlesResult> =>
  json<ArticlesResult>(await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/articles`));
