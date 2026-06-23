import { describe, expect, it } from "bun:test";
import { mcpServersSchema } from "./schema.ts";

describe("mcpServersSchema", () => {
  it("parses a stdio server with args and an env ref", () => {
    const result = mcpServersSchema.parse({
      fs: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        env: { TOKEN: { env: "FS_TOKEN" } },
      },
    });
    expect(result.fs).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      env: { TOKEN: { env: "FS_TOKEN" } },
    });
  });

  it("parses an http server with header refs", () => {
    const result = mcpServersSchema.parse({
      linear: {
        type: "http",
        url: "https://mcp.linear.app/mcp",
        headers: { Authorization: { env: "LINEAR_TOKEN" } },
      },
    });
    expect(result.linear).toEqual({
      type: "http",
      url: "https://mcp.linear.app/mcp",
      headers: { Authorization: { env: "LINEAR_TOKEN" } },
    });
  });

  it("parses an http server with auth: oauth", () => {
    const result = mcpServersSchema.parse({
      linear: { type: "http", url: "https://mcp.linear.app/mcp", auth: "oauth" },
    });
    expect(result.linear).toEqual({
      type: "http",
      url: "https://mcp.linear.app/mcp",
      auth: "oauth",
    });
  });

  it("rejects an unknown auth value", () => {
    expect(() =>
      mcpServersSchema.parse({ x: { type: "http", url: "u", auth: "basic" } }),
    ).toThrow();
  });

  it("rejects auth on a stdio server (strict)", () => {
    expect(() =>
      mcpServersSchema.parse({ x: { type: "stdio", command: "s", auth: "oauth" } }),
    ).toThrow();
  });

  it("parses minimal stdio and http servers", () => {
    const result = mcpServersSchema.parse({
      a: { type: "stdio", command: "server" },
      b: { type: "http", url: "https://example.com/mcp" },
    });
    expect(result.a).toEqual({ type: "stdio", command: "server" });
    expect(result.b).toEqual({ type: "http", url: "https://example.com/mcp" });
  });

  it("requires an explicit type on every server", () => {
    expect(mcpServersSchema.safeParse({ x: { command: "server" } }).success).toBe(false);
  });

  it("rejects an unknown type value", () => {
    expect(() => mcpServersSchema.parse({ x: { type: "ws", url: "u" } })).toThrow();
  });

  it("requires command on a stdio server", () => {
    const result = mcpServersSchema.safeParse({ x: { type: "stdio" } });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["x", "command"]);
  });

  it("requires url on an http server", () => {
    const result = mcpServersSchema.safeParse({ x: { type: "http" } });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["x", "url"]);
  });

  it("rejects a literal (non-env-ref) secret in stdio env", () => {
    expect(() =>
      mcpServersSchema.parse({ x: { type: "stdio", command: "s", env: { TOKEN: "literal" } } }),
    ).toThrow();
  });

  it("rejects a literal (non-env-ref) header value", () => {
    expect(() =>
      mcpServersSchema.parse({
        x: { type: "http", url: "u", headers: { Authorization: "Bearer x" } },
      }),
    ).toThrow();
  });

  it("rejects unknown keys on an entry (strict)", () => {
    expect(() =>
      mcpServersSchema.parse({ x: { type: "stdio", command: "s", junk: true } }),
    ).toThrow();
  });

  it("rejects an empty server name", () => {
    expect(() => mcpServersSchema.parse({ "": { type: "stdio", command: "s" } })).toThrow();
  });

  it("rejects an empty command", () => {
    expect(() => mcpServersSchema.parse({ x: { type: "stdio", command: "" } })).toThrow();
  });
});
