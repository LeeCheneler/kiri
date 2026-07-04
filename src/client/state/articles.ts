import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ArticleDetail,
  type ArticleSummary,
  type SessionArticleDetail,
  fetchArticle,
  fetchSessionArticle,
  fetchSessionArticles,
} from "../api.ts";
import { useLiveEvent, useLiveReconnect } from "../events/live.tsx";

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
 * session can rewrite it in a later turn — so the cache is kept current by
 * `useSessionArticlesLive`, mounted once near the root via `<LiveSync>`.
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
 * by `useSessionArticlesLive`, so an article the model writes mid-turn pops
 * into a mounted list without a navigation.
 */
export function useSessionArticles(sessionId: string): UseQueryResult<ArticleSummary[]> {
  return useQuery({
    queryKey: sessionArticlesKey(sessionId),
    queryFn: async () => (await fetchSessionArticles(sessionId)).articles,
  });
}

/**
 * Bridges `article.written` events to the session article caches: the
 * announced article's detail and its session's list are invalidated whether
 * or not a consumer is currently mounted — an unmounted page's cache goes
 * stale too, so navigating back refetches instead of serving the old body.
 * Reconnect re-syncs every session article query. Mount once near the root
 * via `<LiveSync>`.
 */
export function useSessionArticlesLive(): void {
  const queryClient = useQueryClient();
  useLiveEvent({
    on: ["article.written"],
    handler: (event) => {
      void queryClient.invalidateQueries({
        queryKey: sessionArticleKey(event.sessionId, event.slug),
      });
      void queryClient.invalidateQueries({ queryKey: sessionArticlesKey(event.sessionId) });
    },
  });
  useLiveReconnect(() => {
    void queryClient.invalidateQueries({ queryKey: ["session-article"] });
    void queryClient.invalidateQueries({ queryKey: ["session-articles"] });
  });
}
