import {
  type UseInfiniteQueryResult,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { type ActivityEntry, fetchActivityPage } from "../api.ts";
import { useLiveEvent, useLiveReconnect } from "../events/live.tsx";

/** Query key for the unified activity feed. */
export const activityFeedKey = ["activity", "feed"] as const;

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
