/** Connection state of a configured MCP server, from `GET /api/mcp/servers`. */
export type McpServerState = "connected" | "failed" | "needs-sign-in";

/** A single MCP server's runtime status. */
export interface McpServerStatus {
  name: string;
  type: "stdio" | "http";
  state: McpServerState;
  /** Tools discovered, when connected. */
  toolCount?: number;
  /** Failure reason, when the connection failed. */
  error?: string;
}

/** Per-server MCP status for the UI. */
export interface McpServersResult {
  servers: McpServerStatus[];
}

/**
 * A tool's standing permission: run without prompting, prompt every call,
 * withhold it, or decide per call (tools without a per-call judgement treat
 * `"auto"` as `"ask"`).
 */
export type McpToolPermission = "allow" | "ask" | "off" | "auto";

/** One tool a connected MCP server exposes, with its standing permission. */
export interface McpTool {
  name: string;
  /** The namespaced `<server>__<tool>` name — the key for setting its permission. */
  namespacedName: string;
  description?: string;
  permission: McpToolPermission;
}

/** A configured MCP server with its connection state and, when connected, its tools. */
export interface McpServerTools {
  name: string;
  type: "stdio" | "http";
  state: McpServerState;
  error?: string;
  tools: McpTool[];
}

/** A built-in kiri session tool that carries a standing permission, keyed by its plain `name`. */
export interface McpBuiltinTool {
  name: string;
  description: string;
  permission: McpToolPermission;
}

/** Per-server tools and permissions for the MCP management page, plus the gated built-in kiri tools. */
export interface McpToolsResult {
  servers: McpServerTools[];
  builtin: McpBuiltinTool[];
}

/** SetToolPermission request body. */
export type SetToolPermissionRequest = { tool: string; permission: McpToolPermission };
