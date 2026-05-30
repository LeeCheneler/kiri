import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import { type RunDetail, fetchRun } from "../api.ts";
import { useLiveEvent, useLiveReconnect } from "../events/live.tsx";

const runKey = (id: string) => ["run", id] as const;

/**
 * Read a single run's detail, fetching on first use and serving the cache
 * thereafter. Kept current by `useRunsLive`, so consumers never refetch
 * by hand.
 */
export function useRun(id: string): UseQueryResult<RunDetail> {
  return useQuery({ queryKey: runKey(id), queryFn: () => fetchRun(id) });
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
