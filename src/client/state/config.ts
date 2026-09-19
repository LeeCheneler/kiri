import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ConfigHealth, fetchConfigHealth } from "../api.ts";
import { configHealthKey } from "./query-keys.ts";

/**
 * Read the workspace's configuration-health report. Fetched on first use and
 * refreshed by `<LiveSync>` and on focus, since Codex login can
 * change credentials outside Kiri's configuration watcher.
 */
export function useConfigHealth(): UseQueryResult<ConfigHealth> {
  return useQuery({
    queryKey: configHealthKey,
    queryFn: fetchConfigHealth,
    refetchOnWindowFocus: "always",
  });
}
