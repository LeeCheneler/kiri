import type { MCPClientConfig } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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
  authProvider?: OAuthClientProvider,
): MCPClientConfig["transport"] {
  if (server.type === "stdio") {
    return new Experimental_StdioMCPTransport({
      command: server.command,
      args: server.args,
      env: resolveValues(server.envRefs, env),
    });
  }
  if (authProvider) {
    // OAuth http: use the official MCP SDK's Streamable-HTTP transport, whose
    // OAuth handles discovery, refresh, and sign-in robustly (the @ai-sdk/mcp
    // OAuth path mishandles real servers' issuer/discovery quirks). @ai-sdk/mcp
    // drives it as a custom transport — the two SDKs' transports are both the MCP
    // spec's `Transport`, structurally compatible, cast at this boundary.
    return new StreamableHTTPClientTransport(new URL(server.url), {
      authProvider,
      requestInit: { headers: resolveValues(server.headerRefs, env) },
    }) as unknown as MCPClientConfig["transport"];
  }
  return { type: "http", url: server.url, headers: resolveValues(server.headerRefs, env) };
}

/**
 * Connect to one resolved MCP server. Builds its transport (a spawned
 * subprocess for `stdio`, a Streamable-HTTP session for `http`), reading secret
 * values from `env` at this point only — they are never stored. An `authProvider`
 * (only for an OAuth http server) swaps in the official SDK's transport so it can
 * present and refresh tokens; a server needing sign-in throws `UnauthorizedError`
 * from here. The MCP client is created via the injected `createClient` (the real
 * `createMCPClient` in production).
 */
export function connectMcpServer(
  server: McpServer,
  env: Record<string, string | undefined>,
  createClient: CreateMcpClient,
  authProvider?: OAuthClientProvider,
): Promise<McpClient> {
  return createClient({ transport: mcpTransport(server, env, authProvider) });
}
