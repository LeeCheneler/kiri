import { describe, expect, it } from "bun:test";
import type { MCPClientConfig, OAuthClientProvider } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { type CreateMcpClient, connectMcpServer } from "./connect.ts";
import type { McpServer } from "./schema.ts";

/** A createClient that records the config it was handed and returns a no-op client. */
const capturing = (): { create: CreateMcpClient; config: () => MCPClientConfig } => {
  let captured: MCPClientConfig | undefined;
  return {
    create: async (config) => {
      captured = config;
      return { tools: async () => ({}), close: async () => {} };
    },
    config: () => {
      if (!captured) throw new Error("createClient was not called");
      return captured;
    },
  };
};

describe("connectMcpServer", () => {
  it("builds a stdio transport, resolving env values from the environment", async () => {
    const cap = capturing();
    const server: McpServer = {
      name: "fs",
      type: "stdio",
      command: "npx",
      args: ["-y", "server"],
      envRefs: { TOKEN: "FS_TOKEN" },
    };
    await connectMcpServer(server, { FS_TOKEN: "secret" }, cap.create);
    expect(cap.config().transport).toBeInstanceOf(Experimental_StdioMCPTransport);
  });

  it("builds a stdio transport for a server with no env", async () => {
    const cap = capturing();
    await connectMcpServer({ name: "x", type: "stdio", command: "server" }, {}, cap.create);
    expect(cap.config().transport).toBeInstanceOf(Experimental_StdioMCPTransport);
  });

  it("builds an http transport, resolving header values from the environment", async () => {
    const cap = capturing();
    const server: McpServer = {
      name: "linear",
      type: "http",
      url: "https://mcp.linear.app/mcp",
      headerRefs: { Authorization: "LINEAR_TOKEN" },
    };
    await connectMcpServer(server, { LINEAR_TOKEN: "Bearer x" }, cap.create);
    expect(cap.config().transport).toEqual({
      type: "http",
      url: "https://mcp.linear.app/mcp",
      headers: { Authorization: "Bearer x" },
    });
  });

  it("builds an http transport for a server with no headers", async () => {
    const cap = capturing();
    await connectMcpServer({ name: "x", type: "http", url: "u" }, {}, cap.create);
    expect(cap.config().transport).toEqual({ type: "http", url: "u" });
  });

  it("attaches the OAuth provider to an http transport when given one", async () => {
    const cap = capturing();
    const authProvider = { tokens: () => undefined } as unknown as OAuthClientProvider;
    await connectMcpServer({ name: "x", type: "http", url: "u" }, {}, cap.create, authProvider);
    expect(cap.config().transport).toEqual({ type: "http", url: "u", authProvider });
  });

  it("drops a header whose env var is unset at connect time", async () => {
    const cap = capturing();
    const server: McpServer = {
      name: "x",
      type: "http",
      url: "u",
      headerRefs: { Authorization: "GONE" },
    };
    await connectMcpServer(server, {}, cap.create);
    expect(cap.config().transport).toEqual({ type: "http", url: "u", headers: {} });
  });
});
