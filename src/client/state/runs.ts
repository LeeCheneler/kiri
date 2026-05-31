import {
  type UseInfiniteQueryResult,
  type UseQueryResult,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { type RunDetail, type RunListEntry, fetchRun, fetchRunsPage } from "../api.ts";
import { useLiveEvent, useLiveReconnect } from "../events/live.tsx";

const runKey = (id: string) => ["run", id] as const;
const runWindowKey = (workflow: string, limit: number) =>
  ["runs", "window", workflow, limit] as const;
const runFeedKey = (workflow: string) => ["runs", "feed", workflow] as const;
/** Key for the unscoped, all-workflows run feed — the prefix the per-workflow feed keys extend. */
const allRunsFeedKey = ["runs", "feed"] as const;

/** Page size for the workflow run feed; mirrors the server's default. */
const FEED_PAGE_SIZE = 25;

/**
 * Read a single run's detail, fetching on first use and serving the cache
 * thereafter. Kept current by `useRunsLive`, so consumers never refetch
 * by hand.
 */
export function useRun(id: string): UseQueryResult<RunDetail> {
  return useQuery({ queryKey: runKey(id), queryFn: () => fetchRun(id) });
}

/**
 * Read the most recent `limit` runs for one workflow, newest first — the window
 * the at-a-glance stats panel charts. Fetches on first use and serves the cache
 * thereafter, kept current by `useRunWindowsLive` so the panel recounts as runs
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
 * single newest-first array. Kept current by `useRunFeedsLive`, which
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
 * `useRunFeedsLive` invalidation keeps this feed and the scoped ones
 * current alike.
 */
export function useRunFeed(): UseInfiniteQueryResult<RunListEntry[], Error> {
  return useInfiniteQuery({
    queryKey: allRunsFeedKey,
    queryFn: ({ pageParam }) => fetchRunsPage({ cursor: pageParam, limit: FEED_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    select: (data) => data.pages.flatMap((page) => page.runs),
  });
}

/**
 * Invalidate a run's cached detail as its lifecycle changes: its own
 * run/step events, plus the recommendation events that fold a spawned
 * run's status onto the producing run (actioned, and the reflected status
 * updates from the server). Each event names the affected run, so the
 * invalidation is keyed — only a mounted detail for that run refetches.
 * On event-stream reconnect every run query is invalidated so a mounted
 * detail recovers anything missed while disconnected. Mount once near the
 * root via `<LiveSync>`.
 */
export function useRunsLive(): void {
  const queryClient = useQueryClient();
  useLiveEvent({
    on: [
      "run.updated",
      "run.step.updated",
      "run.finished",
      "recommendation.actioned",
      "recommendation.updated",
    ],
    handler: (event) => {
      const id = "runId" in event ? event.runId : event.id;
      void queryClient.invalidateQueries({ queryKey: runKey(id) });
    },
  });
  useLiveReconnect(() => {
    void queryClient.invalidateQueries({ queryKey: ["run"] });
  });
}

/**
 * Invalidate the cached run windows as runs start, change, finish, or are
 * deleted, so the stats panels they feed recount without a manual refetch. The
 * lifecycle events don't all name their workflow, so this invalidates the whole
 * `["runs", "window"]` subtree rather than a single key; reconnect does the same
 * to recover anything missed while disconnected. Mount once near the root via
 * `<LiveSync>`.
 */
export function useRunWindowsLive(): void {
  const queryClient = useQueryClient();
  useLiveEvent({
    on: ["run.started", "run.updated", "run.finished", "run.deleted"],
    handler: () => {
      void queryClient.invalidateQueries({ queryKey: ["runs", "window"] });
    },
  });
  useLiveReconnect(() => {
    void queryClient.invalidateQueries({ queryKey: ["runs", "window"] });
  });
}

/**
 * Invalidate the cached workflow run feeds as runs start, change, finish, or
 * are deleted, so a mounted feed refetches its loaded pages and reflects the
 * change. The lifecycle events don't all name their workflow, so this
 * invalidates the whole `["runs", "feed"]` subtree rather than a single key;
 * reconnect does the same to recover anything missed while disconnected.
 * Mount once near the root via `<LiveSync>`.
 */
export function useRunFeedsLive(): void {
  const queryClient = useQueryClient();
  useLiveEvent({
    on: ["run.started", "run.updated", "run.finished", "run.deleted"],
    handler: () => {
      void queryClient.invalidateQueries({ queryKey: ["runs", "feed"] });
    },
  });
  useLiveReconnect(() => {
    void queryClient.invalidateQueries({ queryKey: ["runs", "feed"] });
  });
}
