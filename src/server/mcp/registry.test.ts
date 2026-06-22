import { describe, expect, it } from "bun:test";
import { type Tool, type ToolSet, tool } from "ai";
import { z } from "zod";
import { createMcpRegistry } from "./registry.ts";
import type { McpServer } from "./schema.ts";

const aTool = (): Tool =>
  tool({ description: "t", inputSchema: z.object({}), execute: async () => "ok" });

const stdio = (name: string): McpServer => ({ name, type: "stdio", command: "x" });

const serverMap = (...servers: McpServer[]): Map<string, McpServer> =>
  new Map(servers.map((s) => [s.name, s]));

describe("createMcpRegistry", () => {
  it("starts empty with no tools or status", () => {
    const registry = createMcpRegistry(async () => ({
      tools: async () => ({}),
      close: async () => {},
    }));
    expect(registry.tools()).toEqual({});
    expect(registry.status()).toEqual([]);
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
});
