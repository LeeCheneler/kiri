import {
  type UseInfiniteQueryResult,
  type UseQueryResult,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { type RunDetail, type RunListEntry, fetchRun, fetchRunsPage } from "../api.ts";
import { runFeedKey, runKey, runWindowKey } from "./query-keys.ts";

/** Page size for the workflow run feed; mirrors the server's default. */
const FEED_PAGE_SIZE = 25;

/**
 * Read a single run's detail, fetching on first use and serving the cache
 * thereafter. Kept current by `<LiveSync>`, so consumers never refetch
 * by hand.
 */
export function useRun(id: string): UseQueryResult<RunDetail> {
  return useQuery({ queryKey: runKey(id), queryFn: () => fetchRun(id) });
}

/**
 * Read the most recent `limit` runs for one workflow, newest first — the window
 * the at-a-glance stats panel charts. Fetches on first use and serves the cache
 * thereafter, kept current by `<LiveSync>` so the panel recounts as runs
 * come and go without a manual refetch.
 */
export function useWorkflowRunWindow(
  workflow: string,
  limit: number,
): UseQueryResult<RunListEntry[]> {
  return useQuery({
    queryKey: runWindowKey(workflow, limit),
    queryFn: () => fetchRunsPage({ workflow, limit }),
    select: (page) => page.runs,
  });
}

/**
 * Read one workflow's full run history as an infinite, cursor-paginated
 * feed, newest first. The first page fetches on mount; `fetchNextPage`
 * advances by the previous page's `nextCursor` until it runs dry
 * (`hasNextPage` false). `data` is the loaded pages flattened into a
 * single newest-first array. Kept current by `<LiveSync>`, which
 * invalidates the feed on run lifecycle events so a TanStack refetch of
 * all loaded pages folds in starts, updates, finishes, and deletes
 * without manual cache surgery.
 */
export function useWorkflowRunFeed(
  workflow: string,
): UseInfiniteQueryResult<RunListEntry[], Error> {
  return useInfiniteQuery({
    queryKey: runFeedKey(workflow),
    queryFn: ({ pageParam }) =>
      fetchRunsPage({ workflow, cursor: pageParam, limit: FEED_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    select: (data) => data.pages.flatMap((page) => page.runs),
  });
}

/**
 * Read the full run history across all workflows as an infinite,
 * cursor-paginated feed, newest first — the home activity feed. Same shape
 * as `useWorkflowRunFeed` with no workflow filter; its `["runs", "feed"]`
 * key is the prefix the per-workflow feed keys extend, so the single
 * `<LiveSync>` invalidation keeps this feed and the scoped ones
 * current alike.
 */
export function useRunFeed(): UseInfiniteQueryResult<RunListEntry[], Error> {
  return useInfiniteQuery({
    queryKey: runFeedKey(),
    queryFn: ({ pageParam }) => fetchRunsPage({ cursor: pageParam, limit: FEED_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    select: (data) => data.pages.flatMap((page) => page.runs),
  });
}
