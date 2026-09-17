import { describe, expect, it } from "bun:test";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { type Tool, type ToolExecutionOptions, type ToolSet, tool } from "ai";
import { z } from "zod";
import type { McpClient } from "./connect.ts";
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

  it("keeps the latest replacement when connections finish in reverse order", async () => {
    const old = Promise.withResolvers<McpClient>();
    const closed: string[] = [];
    let discoveries = 0;
    const registry = createMcpRegistry(async (server) => {
      if (server.name === "old") return old.promise;
      return {
        tools: async () => ({ t: aTool() }),
        close: async () => {
          closed.push(server.name);
        },
      };
    });
    await registry.replace(serverMap(stdio("initial")), {});
    const stale = registry.replace(serverMap(stdio("old")), {});
    await registry.replace(serverMap(stdio("new")), {});
    old.resolve({
      tools: async () => {
        discoveries++;
        return { t: aTool() };
      },
      close: async () => {
        closed.push("old");
      },
    });
    await stale;

    expect(discoveries).toBe(0);
    expect(Object.keys(registry.tools())).toEqual(["new__t"]);
    expect(registry.status().map((s) => s.name)).toEqual(["new"]);
    expect(registry.catalog().map((s) => s.name)).toEqual(["new"]);
    expect(closed.sort()).toEqual(["initial", "old"]);
    await registry.close();
    expect(closed.sort()).toEqual(["initial", "new", "old"]);
  });

  for (const fails of [false, true]) {
    it(`closes superseded discovery immediately and exactly once (${fails ? "failure" : "success"})`, async () => {
      const discovery = Promise.withResolvers<ToolSet>();
      const started = Promise.withResolvers<void>();
      const closed = Promise.withResolvers<void>();
      let closes = 0;
      const registry = createMcpRegistry(async (server) => ({
        tools: async () => {
          if (server.name === "old") {
            started.resolve();
            return discovery.promise;
          }
          return { t: aTool() };
        },
        close: async () => {
          if (server.name === "old") {
            closes++;
            closed.resolve();
          }
        },
      }));
      const stale = registry.replace(serverMap(stdio("old")), {});
      await started.promise;
      await registry.replace(serverMap(stdio("new")), {});
      await closed.promise;
      if (fails) discovery.reject(new Error("closed during discovery"));
      else discovery.resolve({ t: aTool() });
      await stale;

      expect(closes).toBe(1);
      expect(Object.keys(registry.tools())).toEqual(["new__t"]);
      await registry.close();
      expect(closes).toBe(1);
    });
  }

  it("keeps the live client available while its predecessor is still closing", async () => {
    const closing = Promise.withResolvers<void>();
    const startedClosing = Promise.withResolvers<void>();
    const connectLast = Promise.withResolvers<McpClient>();
    const closed: string[] = [];
    const registry = createMcpRegistry(async (server) => {
      if (server.name === "last") return connectLast.promise;
      return {
        tools: async () => ({ t: aTool() }),
        close: async () => {
          closed.push(server.name);
          if (server.name === "first") {
            startedClosing.resolve();
            await closing.promise;
          }
        },
      };
    });
    await registry.replace(serverMap(stdio("first")), {});
    const middle = registry.replace(serverMap(stdio("middle")), {});
    await startedClosing.promise;
    const last = registry.replace(serverMap(stdio("last")), {});
    expect(await invoke(registry.tools().middle__t)).toBe("ok");
    expect(closed).toEqual(["first"]);
    connectLast.resolve({ tools: async () => ({}), close: async () => {} });
    await last;
    closing.resolve();
    await middle;
    expect(closed).toEqual(["first", "middle"]);
    await registry.close();
  });

  it("drains pending connections on close and cannot be reopened", async () => {
    const connected = Promise.withResolvers<McpClient>();
    let connects = 0;
    let discovers = 0;
    let closes = 0;
    const registry = createMcpRegistry(async () => {
      connects++;
      return connected.promise;
    });
    const replacing = registry.replace(serverMap(stdio("a")), {});
    const closing = registry.close();
    expect(registry.close()).toBe(closing);
    await registry.replace(serverMap(stdio("b")), {});
    connected.resolve({
      tools: async () => {
        discovers++;
        return { t: aTool() };
      },
      close: async () => {
        closes++;
      },
    });
    await closing;
    await replacing;
    expect(connects).toBe(1);
    expect(discovers).toBe(0);
    expect(closes).toBe(1);
    expect(registry.tools()).toEqual({});
    expect(registry.status()).toEqual([]);
    expect(registry.catalog()).toEqual([]);
  });

  it("closes clients still discovering tools without installing their late results", async () => {
    const discovery = Promise.withResolvers<ToolSet>();
    const started = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    let closes = 0;
    const registry = createMcpRegistry(async () => ({
      tools: async () => {
        started.resolve();
        return discovery.promise;
      },
      close: async () => {
        closes++;
        closed.resolve();
      },
    }));
    const replacing = registry.replace(serverMap(stdio("a")), {});
    await started.promise;
    const closing = registry.close();
    await closed.promise;
    discovery.resolve({ t: aTool() });
    await closing;
    await replacing;
    expect(closes).toBe(1);
    expect(registry.tools()).toEqual({});
    expect(registry.status()).toEqual([]);
    expect(registry.catalog()).toEqual([]);
  });

  it("preserves active call leases across overlapping replacements and close", async () => {
    const call = Promise.withResolvers<string>();
    const staleConnection = Promise.withResolvers<McpClient>();
    const closed: string[] = [];
    const registry = createMcpRegistry(async (server) => {
      if (server.name === "stale") return staleConnection.promise;
      return {
        tools: async () => ({
          t: tool({ inputSchema: z.object({}), execute: () => call.promise }),
        }),
        close: async () => {
          closed.push(server.name);
        },
      };
    });
    await registry.replace(serverMap(stdio("first")), {});
    const firstTool = registry.tools().first__t;
    const firstCall = invoke(firstTool);
    const stale = registry.replace(serverMap(stdio("stale")), {});
    await registry.replace(serverMap(stdio("last")), {});
    const lastTool = registry.tools().last__t;
    const lastCall = invoke(lastTool);
    const closing = registry.close();
    staleConnection.resolve({
      tools: async () => ({}),
      close: async () => {
        closed.push("stale");
      },
    });
    await stale;
    await closing;
    expect(closed).toEqual(["stale"]);
    await expect(invoke(firstTool)).rejects.toThrow("no longer available");
    await expect(invoke(lastTool)).rejects.toThrow("no longer available");
    call.resolve("finished");
    expect(await firstCall).toBe("finished");
    expect(await lastCall).toBe("finished");
    expect(closed.sort()).toEqual(["first", "last", "stale"]);
  });

  it("routes a tool captured before replacement through the current client", async () => {
    let connection = 0;
    const closed = new Set<number>();
    const registry = createMcpRegistry(async () => {
      const id = ++connection;
      return {
        tools: async (): Promise<ToolSet> => ({
          t: tool({
            inputSchema: z.object({}),
            execute: async () => {
              if (closed.has(id))
                throw new Error("Attempted to send a request from a closed client");
              return id;
            },
          }),
        }),
        close: async () => {
          closed.add(id);
        },
      };
    });
    await registry.replace(serverMap(stdio("a")), {});
    const captured = registry.tools().a__t;

    await registry.replace(serverMap(stdio("a")), {});

    expect(closed).toEqual(new Set([1]));
    expect(await invoke(captured)).toBe(2);
  });

  it("rejects a captured tool that is removed by replacement", async () => {
    const registry = createMcpRegistry(async () => ({
      tools: async () => ({ t: aTool() }),
      close: async () => {},
    }));
    await registry.replace(serverMap(stdio("a")), {});
    const captured = registry.tools().a__t;

    await registry.replace(serverMap(), {});

    await expect(invoke(captured)).rejects.toThrow('MCP tool "a__t" is no longer available.');
  });

  it("keeps a replaced client open until its active tool calls settle", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let connection = 0;
    const closed = new Set<number>();
    const registry = createMcpRegistry(async () => {
      const id = ++connection;
      return {
        tools: async (): Promise<ToolSet> => ({
          t: tool({
            inputSchema: z.object({}),
            execute: async () => {
              if (id === 1) await held;
              return id;
            },
          }),
        }),
        close: async () => {
          closed.add(id);
        },
      };
    });
    await registry.replace(serverMap(stdio("a")), {});
    const active = invoke(registry.tools().a__t);

    await registry.replace(serverMap(stdio("a")), {});
    expect(closed.has(1)).toBe(false);

    release();
    expect(await active).toBe(1);
    expect(closed.has(1)).toBe(true);
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
