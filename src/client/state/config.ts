import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { type ConfigHealth, fetchConfigHealth } from "../api.ts";

const configHealthKey = ["config", "health"] as const;

/**
 * Read the workspace's configuration-health report. Fetched on first use and
 * served from cache thereafter — the server reads it fresh per request, so a
 * page reload reflects any config edits without a live-sync here.
 */
export function useConfigHealth(): UseQueryResult<ConfigHealth> {
  return useQuery({ queryKey: configHealthKey, queryFn: fetchConfigHealth });
}
