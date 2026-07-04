import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ArticleDetail,
  type ArticleSummary,
  type SessionArticleDetail,
  fetchArticle,
  fetchSessionArticle,
  fetchSessionArticles,
} from "../api.ts";
import { useLiveSync } from "../events/live.tsx";

const articleKey = (runId: string, slug: string) => ["article", runId, slug] as const;

const sessionArticleKey = (sessionId: string, slug: string) =>
  ["session-article", sessionId, slug] as const;

const sessionArticlesKey = (sessionId: string) => ["session-articles", sessionId] as const;

/**
 * Read a single article by run id and slug, fetching on first use
 * and serving the cache thereafter. Run articles are immutable once written,
 * so there is no live-sync hook — the cache never goes stale, and back/forward
 * navigation repaints without a refetch. The cache is keyed by the pair, so
 * changing either param swaps to a separate entry rather than racing.
 */
export function useArticle(runId: string, slug: string): UseQueryResult<ArticleDetail> {
  return useQuery({ queryKey: articleKey(runId, slug), queryFn: () => fetchArticle(runId, slug) });
}

/**
 * Read a single session-produced article, fetching on first use and serving
 * the cache thereafter. Unlike a run's, a session's article is editable — the
 * session can rewrite it in a later turn — so the query refetches whenever
 * the server announces `article.written` for this session and slug, and on
 * event-stream reconnect. Must render inside `<LiveEventsProvider>`.
 */
export function useSessionArticle(
  sessionId: string,
  slug: string,
): UseQueryResult<SessionArticleDetail> {
  const queryClient = useQueryClient();
  useLiveSync({
    on: ["article.written"],
    filter: (event) => event.sessionId === sessionId && event.slug === slug,
    refetch: () => {
      void queryClient.invalidateQueries({ queryKey: sessionArticleKey(sessionId, slug) });
    },
  });
  return useQuery({
    queryKey: sessionArticleKey(sessionId, slug),
    queryFn: () => fetchSessionArticle(sessionId, slug),
  });
}

/**
 * Read the list of articles a session has written, oldest first. Refetches
 * whenever the server announces `article.written` for this session — a
 * mid-turn create pops into the list without a navigation — and on
 * event-stream reconnect. Must render inside `<LiveEventsProvider>`.
 */
export function useSessionArticles(sessionId: string): UseQueryResult<ArticleSummary[]> {
  const queryClient = useQueryClient();
  useLiveSync({
    on: ["article.written"],
    filter: (event) => event.sessionId === sessionId,
    refetch: () => {
      void queryClient.invalidateQueries({ queryKey: sessionArticlesKey(sessionId) });
    },
  });
  return useQuery({
    queryKey: sessionArticlesKey(sessionId),
    queryFn: async () => (await fetchSessionArticles(sessionId)).articles,
  });
}
