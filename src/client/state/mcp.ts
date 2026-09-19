import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type McpServersResult,
  type McpToolPermission,
  type McpToolsResult,
  fetchMcpServers,
  fetchMcpTools,
  setToolPermission,
} from "../api.ts";
import { mcpServersKey, mcpToolsKey } from "./query-keys.ts";

/**
 * Read the per-server MCP status. Fetched on first use and served from cache
 * thereafter; kept current by `<LiveSync>`.
 */
export function useMcpServers(): UseQueryResult<McpServersResult> {
  return useQuery({ queryKey: mcpServersKey, queryFn: fetchMcpServers });
}

/**
 * Read every configured MCP server with its tools and their standing
 * permissions. Fetched on first use and served from cache; kept current by
 * `<LiveSync>`.
 */
export function useMcpTools(): UseQueryResult<McpToolsResult> {
  return useQuery({ queryKey: mcpToolsKey, queryFn: fetchMcpTools });
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
