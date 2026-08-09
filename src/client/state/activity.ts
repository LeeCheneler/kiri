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
import { useLiveEvent, useLiveReconnect } from "../events/live.tsx";

/** Query key for the unified activity feed. */
export const activityFeedKey = ["activity", "feed"] as const;

/** Query key for the articles feed. */
export const articleFeedKey = ["activity", "articles"] as const;

/** Page size for the activity feed; mirrors the server's default. */
const FEED_PAGE_SIZE = 25;

/**
 * Read the unified activity feed — workflow runs and sessions interleaved
 * newest-first — as an infinite, cursor-paginated query. The first page fetches
 * on mount; `fetchNextPage` advances by the previous page's `nextCursor` until
 * it runs dry (`hasNextPage` false). `data` is the loaded pages flattened into a
 * single newest-first entry list. Kept current by `useActivityFeedLive`.
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
 * `useActivityFeed`. Kept current by `useArticleFeedLive`.
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

/**
 * Invalidate the cached articles feed as articles come and go — and on
 * reconnect — so a mounted feed folds in what a session writes mid-turn. Also
 * listens for `run.finished`, since a run's articles are written as it
 * completes and announce no event of their own, and for the deletions that
 * take a producer's articles with it. Mount once near the root via
 * `<LiveSync>`.
 */
export function useArticleFeedLive(): void {
  const queryClient = useQueryClient();
  useLiveEvent({
    on: [
      "article.written",
      "article.deleted",
      "run.finished",
      "run.deleted",
      "session.deleted",
      "project.deleted",
    ],
    handler: () => {
      void queryClient.invalidateQueries({ queryKey: articleFeedKey });
    },
  });
  useLiveReconnect(() => {
    void queryClient.invalidateQueries({ queryKey: articleFeedKey });
  });
}

/**
 * Invalidate the cached activity feed on any run or session lifecycle event —
 * and on reconnect — so a mounted feed refetches its loaded pages and folds in
 * starts, updates, finishes, and deletes from both kinds without manual cache
 * surgery. Mount once near the root via `<LiveSync>`.
 */
export function useActivityFeedLive(): void {
  const queryClient = useQueryClient();
  useLiveEvent({
    on: [
      "run.started",
      "run.updated",
      "run.finished",
      "run.deleted",
      "session.started",
      "session.message.added",
      "session.updated",
      "session.finished",
      "session.deleted",
    ],
    handler: () => {
      void queryClient.invalidateQueries({ queryKey: activityFeedKey });
    },
  });
  useLiveReconnect(() => {
    void queryClient.invalidateQueries({ queryKey: activityFeedKey });
  });
}
