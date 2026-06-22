import type { MCPClientConfig, OAuthClientProvider } from "@ai-sdk/mcp";
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
  authProvider?: OAuthClientProvider,
): MCPClientConfig["transport"] {
  if (server.type === "stdio") {
    return new Experimental_StdioMCPTransport({
      command: server.command,
      args: server.args,
      env: resolveValues(server.envRefs, env),
    });
  }
  // The OAuth provider is the SDK's switch for token-based auth: with it, a 401
  // drives discovery/refresh/sign-in; without it, a 401 is a hard error.
  return {
    type: "http",
    url: server.url,
    headers: resolveValues(server.headerRefs, env),
    authProvider,
  };
}

/**
 * Connect to one resolved MCP server. Builds its transport (a spawned
 * subprocess for `stdio`, a Streamable-HTTP session for `http`), reading secret
 * values from `env` at this point only — they are never stored. An `authProvider`
 * (only for an OAuth http server) is attached so the SDK can present and refresh
 * tokens; a server needing sign-in throws `UnauthorizedError` from here. The MCP
 * client is created via the injected `createClient` (the real `createMCPClient`
 * in production).
 */
export function connectMcpServer(
  server: McpServer,
  env: Record<string, string | undefined>,
  createClient: CreateMcpClient,
  authProvider?: OAuthClientProvider,
): Promise<McpClient> {
  return createClient({ transport: mcpTransport(server, env, authProvider) });
}
