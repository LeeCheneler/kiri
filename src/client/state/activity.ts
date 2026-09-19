import {
  type UseInfiniteQueryResult,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  type ActivityEntry,
  type ArticleFeedEntry,
  fetchActivityPage,
  fetchArticleFeedPage,
} from "../api.ts";
import { activityFeedKey, articleFeedKey } from "./query-keys.ts";

/** Page size for the activity feed; mirrors the server's default. */
const FEED_PAGE_SIZE = 25;

/**
 * Read the unified activity feed — workflow runs and sessions interleaved
 * newest-first — as an infinite, cursor-paginated query. The first page fetches
 * on mount; `fetchNextPage` advances by the previous page's `nextCursor` until
 * it runs dry (`hasNextPage` false). `data` is the loaded pages flattened into a
 * single newest-first entry list. Kept current by `<LiveSync>`.
 */
export function useActivityFeed(): UseInfiniteQueryResult<ActivityEntry[], Error> {
  return useInfiniteQuery({
    queryKey: activityFeedKey,
    queryFn: ({ pageParam }) => fetchActivityPage({ cursor: pageParam, limit: FEED_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    select: (data) => data.pages.flatMap((page) => page.entries),
  });
}

/**
 * Read the articles feed — every article any run, session, or project has
 * written, newest-first — as an infinite, cursor-paginated query, paging like
 * `useActivityFeed`. Kept current by `<LiveSync>`.
 */
export function useArticleFeed(): UseInfiniteQueryResult<ArticleFeedEntry[], Error> {
  return useInfiniteQuery({
    queryKey: articleFeedKey,
    queryFn: ({ pageParam }) => fetchArticleFeedPage({ cursor: pageParam, limit: FEED_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    select: (data) => data.pages.flatMap((page) => page.entries),
  });
}
