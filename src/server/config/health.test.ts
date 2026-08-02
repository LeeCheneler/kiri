import { describe, expect, it } from "bun:test";
import type { LlmProvider } from "../llm/schema.ts";
import type { McpServer } from "../mcp/schema.ts";
import { type ConfigCheck, evaluateConfigHealth } from "./health.ts";
import type { KiriConfigLoadResult } from "./loader.ts";

const providerMap = (...providers: LlmProvider[]): Map<string, LlmProvider> =>
  new Map(providers.map((p) => [p.name, p]));

const mcpMap = (...servers: McpServer[]): Map<string, McpServer> =>
  new Map(servers.map((s) => [s.name, s]));

const result = (overrides: Partial<KiriConfigLoadResult> = {}): KiriConfigLoadResult => ({
  providers: new Map(),
  mcp: new Map(),
  mcpUnresolved: [],
  modelTiers: {},
  allowedDirectories: [],
  shellDirectories: [],
  ...overrides,
});

const find = (checks: ConfigCheck[], area: ConfigCheck["area"]): ConfigCheck[] =>
  checks.filter((c) => c.area === area);

describe("evaluateConfigHealth", () => {
  it("flags a config load failure as an error and skips the provider summary", () => {
    const { checks } = evaluateConfigHealth({
      kiriConfig: result({ failure: { path: "/w/kiri.yaml", reason: "bad yaml" } }),
      env: {},
    });
    const config = find(checks, "config");
    expect(config).toHaveLength(1);
    expect(config[0].level).toBe("error");
    expect(config[0].detail).toBe("bad yaml");
    // A load failure already explains the empty registry — no provider line.
    expect(find(checks, "providers")).toHaveLength(0);
  });

  it("flags a duplicate config file as degraded", () => {
    const { checks } = evaluateConfigHealth({
      kiriConfig: result({ warning: "both kiri.yaml and kiri.yml exist — using kiri.yaml" }),
      env: {},
    });
    const config = find(checks, "config");
    expect(config).toHaveLength(1);
    expect(config[0].level).toBe("degraded");
  });

  it("emits no config line for a clean load", () => {
    const { checks } = evaluateConfigHealth({ kiriConfig: result(), env: {} });
    expect(find(checks, "config")).toHaveLength(0);
  });

  it("reports no providers as degraded, not an error", () => {
    const { checks } = evaluateConfigHealth({ kiriConfig: result(), env: {} });
    const providers = find(checks, "providers");
    expect(providers).toHaveLength(1);
    expect(providers[0].level).toBe("degraded");
    expect(providers[0].title).toBe("No LLM providers configured");
  });

  it("summarises configured providers by name, pluralising the count", () => {
    const { checks } = evaluateConfigHealth({
      kiriConfig: result({
        providers: providerMap(
          { name: "anthropic", type: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" },
          { name: "openai", type: "openai", apiKeyEnv: "OPENAI_API_KEY" },
        ),
      }),
      env: { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "b" },
    });
    const summary = find(checks, "providers");
    expect(summary).toHaveLength(1);
    expect(summary[0].level).toBe("ok");
    expect(summary[0].title).toBe("2 LLM providers configured");
    expect(summary[0].detail).toBe("anthropic, openai");
  });

  it("uses the singular form for a single provider", () => {
    const { checks } = evaluateConfigHealth({
      kiriConfig: result({
        providers: providerMap({
          name: "anthropic",
          type: "anthropic",
          apiKeyEnv: "ANTHROPIC_API_KEY",
        }),
      }),
      env: { ANTHROPIC_API_KEY: "a" },
    });
    expect(find(checks, "providers")[0].title).toBe("1 LLM provider configured");
  });

  it("errors on a configured provider whose conventional key is unset", () => {
    const { checks } = evaluateConfigHealth({
      kiriConfig: result({
        providers: providerMap({
          name: "anthropic",
          type: "anthropic",
          apiKeyEnv: "ANTHROPIC_API_KEY",
        }),
      }),
      env: {},
    });
    const providers = find(checks, "providers");
    // ok summary plus a per-provider error for the missing key.
    expect(providers.map((c) => c.level)).toEqual(["ok", "error"]);
    expect(providers[1].title).toBe("anthropic: ANTHROPIC_API_KEY is not set");
  });

  it("does not key-check a keyless provider", () => {
    const { checks } = evaluateConfigHealth({
      kiriConfig: result({
        providers: providerMap({
          name: "local",
          type: "openai-compatible",
          baseUrl: "http://localhost:1234/v1",
        }),
      }),
      env: {},
    });
    expect(find(checks, "providers").map((c) => c.level)).toEqual(["ok"]);
  });

  it("summarises configured mcp servers by name, pluralising the count", () => {
    const { checks } = evaluateConfigHealth({
      kiriConfig: result({
        mcp: mcpMap(
          { name: "fs", type: "stdio", command: "npx" },
          { name: "linear", type: "http", url: "https://mcp.linear.app/mcp" },
        ),
      }),
      env: {},
    });
    const mcp = find(checks, "mcp");
    expect(mcp).toHaveLength(1);
    expect(mcp[0].level).toBe("ok");
    expect(mcp[0].title).toBe("2 MCP servers configured");
    expect(mcp[0].detail).toBe("fs, linear");
  });

  it("errors per mcp server whose declared env ref is unset", () => {
    const { checks } = evaluateConfigHealth({
      kiriConfig: result({ mcpUnresolved: [{ name: "linear", missing: ["LINEAR_TOKEN"] }] }),
      env: {},
    });
    const mcp = find(checks, "mcp");
    expect(mcp).toHaveLength(1);
    expect(mcp[0].level).toBe("error");
    expect(mcp[0].title).toBe("linear: LINEAR_TOKEN not set");
  });

  it("emits no mcp line when none are configured", () => {
    const { checks } = evaluateConfigHealth({ kiriConfig: result(), env: {} });
    expect(find(checks, "mcp")).toHaveLength(0);
  });

  it("skips mcp checks when the config failed to load", () => {
    const { checks } = evaluateConfigHealth({
      kiriConfig: result({
        failure: { path: "/w/kiri.yaml", reason: "bad" },
        mcp: mcpMap({ name: "fs", type: "stdio", command: "npx" }),
      }),
      env: {},
    });
    expect(find(checks, "mcp")).toHaveLength(0);
  });
});
