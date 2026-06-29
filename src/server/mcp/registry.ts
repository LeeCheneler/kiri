import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { ToolSet } from "ai";
import { boundMcpTool } from "./bound-tool.ts";
import type { McpClient } from "./connect.ts";
import type { McpServer, McpServerType } from "./schema.ts";

/** Runtime status of a configured MCP server. */
export interface McpServerStatus {
  name: string;
  type: McpServerType;
  /**
   * `needs-sign-in` is an OAuth server with no valid tokens — an expected state
   * surfaced as a Connect prompt, distinct from a `failed` connection.
   */
  state: "connected" | "failed" | "needs-sign-in";
  /** Tools discovered, when connected. */
  toolCount?: number;
  /** Failure reason, when the connection or tool discovery failed. */
  error?: string;
}

/** One tool a connected MCP server exposes. */
export interface McpToolInfo {
  /** The bare tool name as its server exposes it. */
  name: string;
  /** The namespaced `<server>__<tool>` name — the model-facing name and the permission key. */
  namespacedName: string;
  /** The tool's description, when it provides one. */
  description?: string;
}

/** A connected MCP server and the tools it exposes. */
export interface McpServerCatalog {
  name: string;
  tools: McpToolInfo[];
}

/** Connect to one resolved MCP server. Injected so the registry is testable without live servers. */
export type ConnectMcpServer = (
  server: McpServer,
  env: Record<string, string | undefined>,
) => Promise<McpClient>;

/**
 * In-memory MCP client registry. Connects to the servers resolved from the
 * `mcp:` map, discovers each server's tools — namespaced `<server>__<tool>` so
 * names never collide across servers — and exposes them as one AI SDK `ToolSet`
 * for sessions. A server that fails to connect or list tools is recorded in
 * `status` and skipped, never taking down the others. Swapped wholesale on
 * config reload via `replace`, and closed on shutdown.
 */
export interface McpRegistry {
  /** The aggregated, namespaced tools across all connected servers. */
  tools(): ToolSet;
  /** Per-server connection status. */
  status(): McpServerStatus[];
  /** Per-server tool listing, for connected servers — the tools grouped under the server that exposes them. */
  catalog(): McpServerCatalog[];
  /** Connect the given servers, replacing and closing any current connections. */
  replace(
    servers: ReadonlyMap<string, McpServer>,
    env: Record<string, string | undefined>,
  ): Promise<void>;
  /** Close all connections and clear the registry. */
  close(): Promise<void>;
}

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** Create an empty MCP registry that connects servers via `connect`. */
export function createMcpRegistry(connect: ConnectMcpServer): McpRegistry {
  let clients: McpClient[] = [];
  let toolSet: ToolSet = {};
  let statuses: McpServerStatus[] = [];
  let catalogs: McpServerCatalog[] = [];

  const closeAll = (toClose: McpClient[]): Promise<unknown> =>
    Promise.allSettled(toClose.map((client) => client.close()));

  return {
    tools: () => toolSet,
    status: () => statuses,
    catalog: () => catalogs,

    replace: async (servers, env) => {
      const previous = clients;

      const results = await Promise.all(
        [...servers.values()].map(async (server) => {
          let client: McpClient | undefined;
          try {
            client = await connect(server, env);
            const tools = await client.tools();
            return { server, client, tools } as const;
          } catch (cause) {
            // Close a client that connected but failed to list its tools.
            if (client) await closeAll([client]);
            return {
              server,
              error: reasonOf(cause),
              unauthorized: cause instanceof UnauthorizedError,
            } as const;
          }
        }),
      );

      const nextClients: McpClient[] = [];
      const nextTools: ToolSet = {};
      const nextStatuses: McpServerStatus[] = [];
      const nextCatalogs: McpServerCatalog[] = [];
      for (const result of results) {
        if ("error" in result) {
          // An OAuth server with no valid tokens isn't a failure — it needs sign-in.
          nextStatuses.push(
            result.unauthorized
              ? { name: result.server.name, type: result.server.type, state: "needs-sign-in" }
              : {
                  name: result.server.name,
                  type: result.server.type,
                  state: "failed",
                  error: result.error,
                },
          );
          continue;
        }
        nextClients.push(result.client);
        const names = Object.keys(result.tools);
        const toolInfos: McpToolInfo[] = [];
        for (const name of names) {
          const namespacedName = `${result.server.name}__${name}`;
          nextTools[namespacedName] = boundMcpTool(result.tools[name]);
          toolInfos.push({ name, namespacedName, description: result.tools[name].description });
        }
        nextStatuses.push({
          name: result.server.name,
          type: result.server.type,
          state: "connected",
          toolCount: names.length,
        });
        nextCatalogs.push({ name: result.server.name, tools: toolInfos });
      }

      clients = nextClients;
      toolSet = nextTools;
      statuses = nextStatuses;
      catalogs = nextCatalogs;
      await closeAll(previous);
    },

    close: async () => {
      const toClose = clients;
      clients = [];
      toolSet = {};
      statuses = [];
      catalogs = [];
      await closeAll(toClose);
    },
  };
}
