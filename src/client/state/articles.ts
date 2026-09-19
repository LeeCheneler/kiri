import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ArticleDetail,
  type ArticleSummary,
  type SessionArticleDetail,
  deleteSessionArticle,
  fetchArticle,
  fetchSessionArticle,
  fetchSessionArticles,
} from "../api.ts";
import { runArticleKey, sessionArticleKey, sessionArticlesKey } from "./query-keys.ts";

/**
 * Read a single article by run id and slug, fetching on first use and serving
 * the cache thereafter. A rerun rewrites the run's articles in place under the
 * same run id, so the cache is kept current by `<LiveSync>`. The cache is
 * keyed by the pair, so changing either param swaps to a separate entry
 * rather than racing.
 */
export function useArticle(runId: string, slug: string): UseQueryResult<ArticleDetail> {
  return useQuery({
    queryKey: runArticleKey(runId, slug),
    queryFn: () => fetchArticle(runId, slug),
  });
}

/**
 * Read a single session-produced article, fetching on first use and serving
 * the cache thereafter. A session's article is editable — the session can
 * rewrite it in a later turn — so the cache is kept current by
 * `<LiveSync>`.
 */
export function useSessionArticle(
  sessionId: string,
  slug: string,
): UseQueryResult<SessionArticleDetail> {
  return useQuery({
    queryKey: sessionArticleKey(sessionId, slug),
    queryFn: () => fetchSessionArticle(sessionId, slug),
  });
}

/**
 * Read the list of articles a session has written, oldest first. Kept current
 * by `<LiveSync>`, so an article the model writes mid-turn pops
 * into a mounted list without a navigation.
 */
export function useSessionArticles(sessionId: string): UseQueryResult<ArticleSummary[]> {
  return useQuery({
    queryKey: sessionArticlesKey(sessionId),
    queryFn: async () => (await fetchSessionArticles(sessionId)).articles,
  });
}

/**
 * A deleter for a session-owned article: removes it, then invalidates the
 * session's article queries so the list drops it and its page 404s.
 */
export function useDeleteSessionArticle(): (sessionId: string, slug: string) => Promise<void> {
  const queryClient = useQueryClient();
  return async (sessionId, slug) => {
    await deleteSessionArticle(sessionId, slug);
    void queryClient.invalidateQueries({ queryKey: sessionArticleKey(sessionId, slug) });
    void queryClient.invalidateQueries({ queryKey: sessionArticlesKey(sessionId) });
  };
}
