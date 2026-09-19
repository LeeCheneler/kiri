import type { McpServersResult, McpToolPermission, McpToolsResult } from "../../shared/api/mcp.ts";
import type * as requests from "../../shared/api/mcp.ts";

import { apiFetch, apiUrl, assertOk, json } from "./http.ts";

/** Fetch the per-server MCP status. Throws on non-2xx. */
export const fetchMcpServers = async (): Promise<McpServersResult> =>
  json<McpServersResult>(await apiFetch("/api/mcp/servers"));

/** The URL that begins OAuth sign-in for an MCP `server`, opened in a new browser tab. */
export const mcpAuthStartUrl = (server: string): string =>
  apiUrl(`/api/mcp/${encodeURIComponent(server)}/auth/start`);

/** Fetch every configured MCP server with its tools and their standing permissions. Throws on non-2xx. */
export const fetchMcpTools = async (): Promise<McpToolsResult> =>
  json<McpToolsResult>(await apiFetch("/api/mcp/tools"));

/**
 * Set a tool's standing permission by its namespaced `<server>__<tool>` name —
 * `"allow"` runs it without prompting, `"off"` withholds it from the model,
 * `"ask"` clears any recorded decision. Resolves on 204; throws `ApiError` on
 * non-2xx.
 */
export const setToolPermission = async (
  tool: string,
  permission: McpToolPermission,
): Promise<void> => {
  await assertOk(
    await apiFetch("/api/mcp/tool-permissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, permission } satisfies requests.SetToolPermissionRequest),
    }),
  );
};
