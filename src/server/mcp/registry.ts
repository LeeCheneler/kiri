import type { ToolSet } from "ai";
import type { McpClient } from "./connect.ts";
import type { McpServer, McpServerType } from "./schema.ts";

/** Runtime status of a configured MCP server. */
export interface McpServerStatus {
  name: string;
  type: McpServerType;
  state: "connected" | "failed";
  /** Tools discovered, when connected. */
  toolCount?: number;
  /** Failure reason, when the connection or tool discovery failed. */
  error?: string;
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

  const closeAll = (toClose: McpClient[]): Promise<unknown> =>
    Promise.allSettled(toClose.map((client) => client.close()));

  return {
    tools: () => toolSet,
    status: () => statuses,

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
            return { server, error: reasonOf(cause) } as const;
          }
        }),
      );

      const nextClients: McpClient[] = [];
      const nextTools: ToolSet = {};
      const nextStatuses: McpServerStatus[] = [];
      for (const result of results) {
        if ("error" in result) {
          nextStatuses.push({
            name: result.server.name,
            type: result.server.type,
            state: "failed",
            error: result.error,
          });
          continue;
        }
        nextClients.push(result.client);
        const names = Object.keys(result.tools);
        for (const name of names) {
          nextTools[`${result.server.name}__${name}`] = result.tools[name];
        }
        nextStatuses.push({
          name: result.server.name,
          type: result.server.type,
          state: "connected",
          toolCount: names.length,
        });
      }

      clients = nextClients;
      toolSet = nextTools;
      statuses = nextStatuses;
      await closeAll(previous);
    },

    close: async () => {
      const toClose = clients;
      clients = [];
      toolSet = {};
      statuses = [];
      await closeAll(toClose);
    },
  };
}
