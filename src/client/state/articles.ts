import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { type ArticleDetail, fetchArticle } from "../api.ts";

const articleKey = (runId: string, name: string) => ["article", runId, name] as const;

/**
 * Read a single published article by run id and name, fetching on first use
 * and serving the cache thereafter. Articles are immutable once written, so
 * there is no live-sync hook — the cache never goes stale, and back/forward
 * navigation repaints without a refetch. The cache is keyed by the pair, so
 * changing either param swaps to a separate entry rather than racing.
 */
export function useArticle(runId: string, name: string): UseQueryResult<ArticleDetail> {
  return useQuery({ queryKey: articleKey(runId, name), queryFn: () => fetchArticle(runId, name) });
}
