import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ArticleDetail,
  type RecentArticle,
  fetchArticle,
  fetchRecentArticles,
} from "../api.ts";
import { useLiveEvent, useLiveReconnect } from "../events/live.tsx";

const articleKey = (runId: string, slug: string) => ["article", runId, slug] as const;
const recentArticlesKey = ["articles", "recent"] as const;

/**
 * Read a single published article by run id and slug, fetching on first use
 * and serving the cache thereafter. Articles are immutable once written, so
 * there is no live-sync hook — the cache never goes stale, and back/forward
 * navigation repaints without a refetch. The cache is keyed by the pair, so
 * changing either param swaps to a separate entry rather than racing.
 */
export function useArticle(runId: string, slug: string): UseQueryResult<ArticleDetail> {
  return useQuery({ queryKey: articleKey(runId, slug), queryFn: () => fetchArticle(runId, slug) });
}

/**
 * Read the cross-run "recently published" list — the newest articles across
 * every workflow, newest first — fetching on first use and serving the cache
 * thereafter. Kept current by `useRecentArticlesLive`, so the rail it feeds
 * never refetches by hand.
 */
export function useRecentArticles(): UseQueryResult<RecentArticle[]> {
  return useQuery({ queryKey: recentArticlesKey, queryFn: () => fetchRecentArticles() });
}

/**
 * Invalidate the cached recently-published list as runs finish — any articles
 * a run published are persisted by the time it finishes — and as runs are
 * deleted, which cascades to drop their articles. So a mounted rail refetches
 * and reflects the change. Articles are written mid-run at each publish step,
 * but the event bus carries no publish-specific event; `run.finished` is the
 * reliable signal that a run's articles all exist. Reconnect invalidates too,
 * to recover anything missed while disconnected. Mount once near the root via
 * `<LiveSync>`.
 */
export function useRecentArticlesLive(): void {
  const queryClient = useQueryClient();
  useLiveEvent({
    on: ["run.finished", "run.deleted"],
    handler: () => {
      void queryClient.invalidateQueries({ queryKey: recentArticlesKey });
    },
  });
  useLiveReconnect(() => {
    void queryClient.invalidateQueries({ queryKey: recentArticlesKey });
  });
}
