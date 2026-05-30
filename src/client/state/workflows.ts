import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import { type WorkflowSummary, fetchWorkflows } from "../api.ts";
import { useLiveSync } from "../events/live.tsx";

const WORKFLOWS_KEY = ["workflows"] as const;

/**
 * Read the workflow registry, fetching it on first use and serving the
 * cache thereafter. Kept current by `useWorkflowsLive`, so consumers
 * never refetch by hand.
 */
export function useWorkflows(): UseQueryResult<WorkflowSummary[]> {
  return useQuery({ queryKey: WORKFLOWS_KEY, queryFn: fetchWorkflows });
}

/**
 * Invalidate the workflow registry whenever the file watcher reports a
 * definition added, changed, or removed — and on event-stream reconnect,
 * recovering any change missed while disconnected. Mount once near the
 * root via `<LiveSync>`.
 */
export function useWorkflowsLive(): void {
  const queryClient = useQueryClient();
  useLiveSync({
    on: ["workflow.added", "workflow.updated", "workflow.removed"],
    refetch: () => {
      void queryClient.invalidateQueries({ queryKey: WORKFLOWS_KEY });
    },
  });
}
