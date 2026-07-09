import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type McpServersResult,
  type McpToolPermission,
  type McpToolsResult,
  fetchMcpServers,
  fetchMcpTools,
  setToolPermission,
} from "../api.ts";
import { useLiveSync } from "../events/live.tsx";

const mcpServersKey = ["mcp", "servers"] as const;
const mcpToolsKey = ["mcp", "tools"] as const;

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

/**
 * Read every configured MCP server with its tools and their standing
 * permissions. Fetched on first use and served from cache; kept current by
 * `useMcpToolsLive`.
 */
export function useMcpTools(): UseQueryResult<McpToolsResult> {
  return useQuery({ queryKey: mcpToolsKey, queryFn: fetchMcpTools });
}

/**
 * Refetch the MCP tool listing whenever the server reports a config change or an
 * OAuth sign-in completes (both publish `config.changed`), whenever a tool's
 * standing permission is written, and on event-stream reconnect. Mount once near
 * the root via `<LiveSync>`.
 */
export function useMcpToolsLive(): void {
  const queryClient = useQueryClient();
  useLiveSync({
    on: ["config.changed", "tool.permission.updated"],
    refetch: () => {
      void queryClient.invalidateQueries({ queryKey: mcpToolsKey });
    },
  });
}

/**
 * A setter for a tool's standing permission: writes it, then invalidates the
 * tool listing so the change is reflected from the server's truth. Keyed by the
 * tool's namespaced `<server>__<tool>` name.
 */
export function useSetToolPermission(): (
  tool: string,
  permission: McpToolPermission,
) => Promise<void> {
  const queryClient = useQueryClient();
  return async (tool, permission) => {
    await setToolPermission(tool, permission);
    void queryClient.invalidateQueries({ queryKey: mcpToolsKey });
  };
}
