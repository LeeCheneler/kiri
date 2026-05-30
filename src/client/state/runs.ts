import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import { type RunDetail, type RunListEntry, fetchRun, fetchRunsPage } from "../api.ts";
import { useLiveEvent, useLiveReconnect } from "../events/live.tsx";

const runKey = (id: string) => ["run", id] as const;
const runWindowKey = (workflow: string, limit: number) =>
  ["runs", "window", workflow, limit] as const;

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
