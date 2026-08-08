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
import { useLiveEvent, useLiveReconnect } from "../events/live.tsx";

const articleKey = (runId: string, slug: string) => ["article", runId, slug] as const;

const sessionArticleKey = (sessionId: string, slug: string) =>
  ["session-article", sessionId, slug] as const;

const sessionArticlesKey = (sessionId: string) => ["session-articles", sessionId] as const;

/**
 * Read a single article by run id and slug, fetching on first use and serving
 * the cache thereafter. A rerun rewrites the run's articles in place under the
 * same run id, so the cache is kept current by `useRunArticlesLive`, mounted
 * once near the root via `<LiveSync>`. The cache is keyed by the pair, so
 * changing either param swaps to a separate entry rather than racing.
 */
export function useArticle(runId: string, slug: string): UseQueryResult<ArticleDetail> {
  return useQuery({ queryKey: articleKey(runId, slug), queryFn: () => fetchArticle(runId, slug) });
}

/**
 * Bridges run lifecycle events to the run article caches. A rerun reuses the
 * run's id — wiping its articles and writing fresh ones — so `run.finished`
 * invalidates the run's article queries whether or not a consumer is mounted;
 * navigating back to an article after a rerun refetches instead of serving
 * the pre-rerun body. `run.deleted` restales them too, so a deleted run's
 * article 404s rather than rendering from cache. Invalidation waits for
 * `run.finished` rather than reacting to `run.started`, so a mounted article
 * keeps the old body during the rerun instead of flashing not-found while the
 * wiped rows are rewritten. Reconnect re-syncs every run article query. Mount
 * once near the root via `<LiveSync>`.
 */
export function useRunArticlesLive(): void {
  const queryClient = useQueryClient();
  useLiveEvent({
    on: ["run.finished", "run.deleted"],
    handler: (event) => {
      void queryClient.invalidateQueries({ queryKey: ["article", event.id] });
    },
  });
  useLiveReconnect(() => {
    void queryClient.invalidateQueries({ queryKey: ["article"] });
  });
}

/**
 * Read a single session-produced article, fetching on first use and serving
 * the cache thereafter. A session's article is editable — the session can
 * rewrite it in a later turn — so the cache is kept current by
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
  // A deletion restales the same pair — the announced article's detail 404s
  // rather than rendering from cache, and the list drops it. Deletions from
  // the project page carry no session id and touch no session caches.
  useLiveEvent({
    on: ["article.deleted"],
    handler: (event) => {
      if (event.sessionId === undefined) return;
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
