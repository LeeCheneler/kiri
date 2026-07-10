import { describe, expect, it } from "bun:test";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { type Tool, type ToolExecutionOptions, type ToolSet, tool } from "ai";
import { z } from "zod";
import { createMcpRegistry } from "./registry.ts";
import type { McpServer } from "./schema.ts";

const aTool = (): Tool =>
  tool({ description: "t", inputSchema: z.object({}), execute: async () => "ok" });

// A tool whose execute always rejects with `error` — mirrors an @ai-sdk/mcp tool
// whose underlying call throws (an auth loss, or an ordinary failure).
const throwingTool = (error: unknown): Tool =>
  tool({
    description: "t",
    inputSchema: z.object({}),
    // Annotated so the throwing body doesn't infer Promise<never>, which fails
    // tool()'s execute overload.
    execute: async (): Promise<string> => {
      throw error;
    },
  });

// Invoke a registry tool's execute with a minimal ToolExecutionOptions.
const invoke = (t: ToolSet[string]): Promise<unknown> =>
  (t.execute as (input: unknown, options: ToolExecutionOptions) => Promise<unknown>)({}, {
    toolCallId: "c1",
    messages: [],
  } as ToolExecutionOptions);

const stdio = (name: string): McpServer => ({ name, type: "stdio", command: "x" });

const oauthHttp = (name: string): McpServer => ({
  name,
  type: "http",
  url: `https://${name}.test/mcp`,
  oauth: true,
});

const serverMap = (...servers: McpServer[]): Map<string, McpServer> =>
  new Map(servers.map((s) => [s.name, s]));

describe("createMcpRegistry", () => {
  it("starts empty with no tools, status, or catalog", () => {
    const registry = createMcpRegistry(async () => ({
      tools: async () => ({}),
      close: async () => {},
    }));
    expect(registry.tools()).toEqual({});
    expect(registry.status()).toEqual([]);
    expect(registry.catalog()).toEqual([]);
  });

  it("catalogs each connected server's tools with namespaced names and descriptions", async () => {
    const registry = createMcpRegistry(async (server) => ({
      tools: async (): Promise<ToolSet> =>
        server.name === "a" ? { search: aTool() } : { get: aTool() },
      close: async () => {},
    }));
    await registry.replace(serverMap(stdio("a"), stdio("b")), {});
    expect(registry.catalog()).toEqual([
      { name: "a", tools: [{ name: "search", namespacedName: "a__search", description: "t" }] },
      { name: "b", tools: [{ name: "get", namespacedName: "b__get", description: "t" }] },
    ]);
  });

  it("omits failed and needs-sign-in servers from the catalog", async () => {
    const registry = createMcpRegistry(async (server) => {
      if (server.name === "bad") throw new Error("nope");
      if (server.name === "oauth") throw new UnauthorizedError();
      return { tools: async () => ({ search: aTool() }), close: async () => {} };
    });
    await registry.replace(serverMap(stdio("bad"), stdio("oauth"), stdio("good")), {});
    expect(registry.catalog().map((s) => s.name)).toEqual(["good"]);
  });

  it("connects servers and namespaces their tools by server name", async () => {
    const registry = createMcpRegistry(async (server) => ({
      tools: async (): Promise<ToolSet> =>
        server.name === "a" ? { search: aTool() } : { get: aTool() },
      close: async () => {},
    }));
    await registry.replace(serverMap(stdio("a"), stdio("b")), {});
    expect(Object.keys(registry.tools()).sort()).toEqual(["a__search", "b__get"]);
    expect(registry.status()).toEqual([
      { name: "a", type: "stdio", state: "connected", toolCount: 1 },
      { name: "b", type: "stdio", state: "connected", toolCount: 1 },
    ]);
  });

  it("marks a server failed when connect throws, keeping the others", async () => {
    const registry = createMcpRegistry(async (server) => {
      if (server.name === "bad") throw new Error("nope");
      return { tools: async () => ({ search: aTool() }), close: async () => {} };
    });
    await registry.replace(serverMap(stdio("bad"), stdio("good")), {});
    expect(Object.keys(registry.tools())).toEqual(["good__search"]);
    expect(registry.status().find((s) => s.name === "bad")).toEqual({
      name: "bad",
      type: "stdio",
      state: "failed",
      error: "nope",
    });
    expect(registry.status().find((s) => s.name === "good")?.state).toBe("connected");
  });

  it("marks a server needs-sign-in when connect throws UnauthorizedError", async () => {
    const registry = createMcpRegistry(async (server) => {
      if (server.name === "oauth") throw new UnauthorizedError();
      return { tools: async () => ({ search: aTool() }), close: async () => {} };
    });
    await registry.replace(serverMap(stdio("oauth"), stdio("good")), {});
    expect(Object.keys(registry.tools())).toEqual(["good__search"]);
    expect(registry.status().find((s) => s.name === "oauth")).toEqual({
      name: "oauth",
      type: "stdio",
      state: "needs-sign-in",
    });
    expect(registry.status().find((s) => s.name === "good")?.state).toBe("connected");
  });

  it("closes a half-open client and marks it failed when tool discovery throws", async () => {
    let closed = false;
    const registry = createMcpRegistry(async () => ({
      tools: async () => {
        throw new Error("list failed");
      },
      close: async () => {
        closed = true;
      },
    }));
    await registry.replace(serverMap(stdio("a")), {});
    expect(closed).toBe(true);
    expect(registry.tools()).toEqual({});
    expect(registry.status()[0]).toEqual({
      name: "a",
      type: "stdio",
      state: "failed",
      error: "list failed",
    });
  });

  it("closes previous clients when replaced", async () => {
    const closes: string[] = [];
    const registry = createMcpRegistry(async (server) => ({
      tools: async () => ({ t: aTool() }),
      close: async () => {
        closes.push(server.name);
      },
    }));
    await registry.replace(serverMap(stdio("a")), {});
    await registry.replace(serverMap(stdio("b")), {});
    expect(closes).toEqual(["a"]);
    expect(Object.keys(registry.tools())).toEqual(["b__t"]);
  });

  it("closes all clients and clears state on close", async () => {
    let closed = 0;
    const registry = createMcpRegistry(async () => ({
      tools: async () => ({ t: aTool() }),
      close: async () => {
        closed += 1;
      },
    }));
    await registry.replace(serverMap(stdio("a"), stdio("b")), {});
    await registry.close();
    expect(closed).toBe(2);
    expect(registry.tools()).toEqual({});
    expect(registry.status()).toEqual([]);
  });

  it("flips a server to needs-sign-in when a tool call loses OAuth", async () => {
    const lost: string[] = [];
    const registry = createMcpRegistry(
      async (server) => ({
        tools: async (): Promise<ToolSet> =>
          server.name === "oauth"
            ? { search: throwingTool(new UnauthorizedError()) }
            : { get: aTool() },
        close: async () => {},
      }),
      (name) => lost.push(name),
    );
    await registry.replace(serverMap(oauthHttp("oauth"), stdio("good")), {});

    await expect(invoke(registry.tools().oauth__search)).rejects.toThrow(/needs re-authentication/);

    expect(lost).toEqual(["oauth"]);
    expect(Object.keys(registry.tools())).toEqual(["good__get"]);
    expect(registry.catalog().map((s) => s.name)).toEqual(["good"]);
    expect(registry.status().find((s) => s.name === "oauth")).toEqual({
      name: "oauth",
      type: "http",
      state: "needs-sign-in",
    });
    expect(registry.status().find((s) => s.name === "good")?.state).toBe("connected");
  });

  it("treats a 401 from the transport as a lost sign-in", async () => {
    const registry = createMcpRegistry(async () => ({
      tools: async (): Promise<ToolSet> => ({
        search: throwingTool(new StreamableHTTPError(401, "unauthorized")),
      }),
      close: async () => {},
    }));
    await registry.replace(serverMap(oauthHttp("oauth")), {});
    await expect(invoke(registry.tools().oauth__search)).rejects.toThrow(/needs re-authentication/);
    expect(registry.status()[0].state).toBe("needs-sign-in");
  });

  it("leaves a server connected when a tool call fails for a non-auth reason", async () => {
    const lost: string[] = [];
    const registry = createMcpRegistry(
      async () => ({
        tools: async (): Promise<ToolSet> => ({ search: throwingTool(new Error("boom")) }),
        close: async () => {},
      }),
      (name) => lost.push(name),
    );
    await registry.replace(serverMap(oauthHttp("oauth")), {});
    await expect(invoke(registry.tools().oauth__search)).rejects.toThrow("boom");
    expect(lost).toEqual([]);
    expect(Object.keys(registry.tools())).toEqual(["oauth__search"]);
    expect(registry.status()[0].state).toBe("connected");
  });

  it("notifies once when the same server loses OAuth on a second call", async () => {
    const lost: string[] = [];
    const registry = createMcpRegistry(
      async () => ({
        tools: async (): Promise<ToolSet> => ({
          a: throwingTool(new UnauthorizedError()),
          b: throwingTool(new UnauthorizedError()),
        }),
        close: async () => {},
      }),
      (name) => lost.push(name),
    );
    await registry.replace(serverMap(oauthHttp("oauth")), {});
    const a = registry.tools().oauth__a;
    const b = registry.tools().oauth__b;
    await expect(invoke(a)).rejects.toThrow(/needs re-authentication/);
    await expect(invoke(b)).rejects.toThrow(/needs re-authentication/);
    expect(lost).toEqual(["oauth"]);
  });
});
