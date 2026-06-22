import type { MCPClientConfig } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import type { ToolSet } from "ai";
import type { McpServer } from "./schema.ts";

/** The MCP client surface the registry depends on — a subset of @ai-sdk/mcp's `MCPClient`. */
export interface McpClient {
  /** The server's tools, already in AI SDK form. */
  tools(): Promise<ToolSet>;
  /** Disconnect and clean up (kills the stdio subprocess / closes the HTTP session). */
  close(): Promise<void>;
}

/**
 * Creates an MCP client from a transport config. Matches @ai-sdk/mcp's
 * `createMCPClient`; injected so the transport-building logic can be tested
 * without a live server.
 */
export type CreateMcpClient = (config: MCPClientConfig) => Promise<McpClient>;

/** Read secret values for a `{ key: <ENV_VAR_NAME> }` map, dropping any whose var is unset. */
function resolveValues(
  refs: Record<string, string> | undefined,
  env: Record<string, string | undefined>,
): Record<string, string> | undefined {
  if (!refs) return undefined;
  const values: Record<string, string> = {};
  for (const [key, name] of Object.entries(refs)) {
    const value = env[name];
    if (value !== undefined) values[key] = value;
  }
  return values;
}

/** Build the @ai-sdk/mcp transport for a resolved server, reading secret values from env. */
function mcpTransport(
  server: McpServer,
  env: Record<string, string | undefined>,
): MCPClientConfig["transport"] {
  if (server.type === "stdio") {
    return new Experimental_StdioMCPTransport({
      command: server.command,
      args: server.args,
      env: resolveValues(server.envRefs, env),
    });
  }
  return { type: "http", url: server.url, headers: resolveValues(server.headerRefs, env) };
}

/**
 * Connect to one resolved MCP server. Builds its transport (a spawned
 * subprocess for `stdio`, a Streamable-HTTP session for `http`), reading secret
 * values from `env` at this point only — they are never stored. The MCP client
 * is created via the injected `createClient` (the real `createMCPClient` in
 * production).
 */
export function connectMcpServer(
  server: McpServer,
  env: Record<string, string | undefined>,
  createClient: CreateMcpClient,
): Promise<McpClient> {
  return createClient({ transport: mcpTransport(server, env) });
}
