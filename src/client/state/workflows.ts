import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import { type WorkflowSummary, fetchWorkflows } from "../api.ts";
import { workflowsKey } from "./query-keys.ts";

/**
 * Read the workflow registry, fetching it on first use and serving the
 * cache thereafter. Kept current by `<LiveSync>`, so consumers
 * never refetch by hand.
 */
export function useWorkflows(): UseQueryResult<WorkflowSummary[]> {
  return useQuery({ queryKey: workflowsKey, queryFn: fetchWorkflows });
}
