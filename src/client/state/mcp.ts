import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import { type McpServersResult, fetchMcpServers } from "../api.ts";
import { useLiveSync } from "../events/live.tsx";

const mcpServersKey = ["mcp", "servers"] as const;

/**
 * Read the per-server MCP status. Fetched on first use and served from cache
 * thereafter; kept current by `useMcpServersLive`.
 */
export function useMcpServers(): UseQueryResult<McpServersResult> {
  return useQuery({ queryKey: mcpServersKey, queryFn: fetchMcpServers });
}

/**
 * Refetch the MCP status whenever the server reports a config change or an OAuth
 * sign-in completes (both publish `config.changed`), and on event-stream
 * reconnect. Mount once near the root via `<LiveSync>`.
 */
export function useMcpServersLive(): void {
  const queryClient = useQueryClient();
  useLiveSync({
    on: ["config.changed"],
    refetch: () => {
      void queryClient.invalidateQueries({ queryKey: mcpServersKey });
    },
  });
}
