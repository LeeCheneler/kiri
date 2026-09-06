import { describe, expect, it } from "bun:test";
import type { LlmClients } from "../llm/index.ts";
import type { LlmProvider } from "../llm/schema.ts";
import type { McpServer } from "../mcp/schema.ts";
import { type ConfigCheck, evaluateConfigHealth, evaluateModelListingHealth } from "./health.ts";
import type { KiriConfigLoadResult } from "./loader.ts";

const providerMap = (...providers: LlmProvider[]): Map<string, LlmProvider> =>
  new Map(providers.map((p) => [p.name, p]));

const mcpMap = (...servers: McpServer[]): Map<string, McpServer> =>
  new Map(servers.map((s) => [s.name, s]));

const result = (overrides: Partial<KiriConfigLoadResult> = {}): KiriConfigLoadResult => ({
  providers: new Map(),
  mcp: new Map(),
  mcpUnresolved: [],
  models: { shortcuts: {}, delegates: {} },
  allowedDirectories: [],
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

  it("emits no models line when none are configured", () => {
    const { checks } = evaluateConfigHealth({ kiriConfig: result(), env: {} });
    expect(find(checks, "models")).toHaveLength(0);
  });

  it("summarises resolvable model references as ok", () => {
    const { checks } = evaluateConfigHealth({
      kiriConfig: result({
        providers: providerMap({ name: "a", type: "openai-compatible", baseUrl: "http://x" }),
        models: {
          shortcuts: { text: { sonnet: "a:mid" }, image: { images: "a:img" } },
          delegates: { daily: "a:mid" },
          utility: "a:small",
          transcription: "a:whisper",
        },
      }),
      env: {},
    });
    const models = find(checks, "models");
    expect(models).toHaveLength(1);
    expect(models[0].level).toBe("ok");
    expect(models[0].title).toBe("5 model references configured");
    expect(models[0].detail).toBe(
      "shortcuts.text.sonnet, shortcuts.image.images, delegates.daily, utility, transcription",
    );
  });

  it("flags a malformed model reference as an error", () => {
    const { checks } = evaluateConfigHealth({
      kiriConfig: result({
        providers: providerMap({ name: "a", type: "openai-compatible", baseUrl: "http://x" }),
        models: {
          shortcuts: { text: { bare: "no-colon", trailing: "a:" } },
          delegates: {},
        },
      }),
      env: {},
    });
    const errors = find(checks, "models").filter((c) => c.level === "error");
    expect(errors.map((c) => c.title)).toEqual([
      "shortcuts.text.bare: not a provider:model reference",
      "shortcuts.text.trailing: not a provider:model reference",
    ]);
  });

  it("flags a reference to an unconfigured provider as an error, naming the configured ones", () => {
    const { checks } = evaluateConfigHealth({
      kiriConfig: result({
        providers: providerMap({ name: "a", type: "openai-compatible", baseUrl: "http://x" }),
        models: { shortcuts: {}, delegates: { deep: "missing:big" } },
      }),
      env: {},
    });
    const errors = find(checks, "models").filter((c) => c.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].title).toBe('delegates.deep: unknown provider "missing"');
    expect(errors[0].detail).toContain("configured: a");
  });

  it("points at the providers section when none are configured at all", () => {
    const { checks } = evaluateConfigHealth({
      kiriConfig: result({ models: { shortcuts: { text: { flash: "a:small" } }, delegates: {} } }),
      env: {},
    });
    const errors = find(checks, "models").filter((c) => c.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].detail).toContain("declared under providers:");
  });

  it("skips model checks when the config failed to load", () => {
    const { checks } = evaluateConfigHealth({
      kiriConfig: result({
        failure: { path: "/w/kiri.yaml", reason: "bad" },
        models: { shortcuts: { text: { flash: "a:small" } }, delegates: {} },
      }),
      env: {},
    });
    expect(find(checks, "models")).toHaveLength(0);
  });
});

describe("evaluateModelListingHealth", () => {
  const clientsListing = (
    models: { id: string; provider: string }[],
    failures: { provider: string; reason: string }[] = [],
  ): LlmClients => ({
    resolveModel: () => {
      throw new Error("unused in this fake");
    },
    resolveImageModel: () => {
      throw new Error("unused in this fake");
    },
    resolveTranscriptionModel: () => {
      throw new Error("unused in this fake");
    },
    generateText: async () => ({ text: "", usage: {} }),
    listModels: async () => ({
      models: models.map((m) => ({ ...m, output: "text" as const, reasoning: false })),
      failures,
    }),
    contextWindowFor: async () => undefined,
    reasoningOptionsFor: async () => undefined,
  });

  const configured = (models: KiriConfigLoadResult["models"]): KiriConfigLoadResult =>
    result({
      providers: providerMap({ name: "a", type: "openai-compatible", baseUrl: "http://x" }),
      models,
    });

  it("flags a reference the provider's listing doesn't carry as degraded", async () => {
    const checks = await evaluateModelListingHealth(
      configured({ shortcuts: { text: { real: "a:listed", typo: "a:missing" } }, delegates: {} }),
      clientsListing([{ id: "a:listed", provider: "a" }]),
    );
    expect(checks).toHaveLength(1);
    expect(checks[0].level).toBe("degraded");
    expect(checks[0].title).toBe("shortcuts.text.typo: model not listed");
  });

  it("skips references whose provider's listing failed", async () => {
    const checks = await evaluateModelListingHealth(
      configured({ shortcuts: {}, delegates: { daily: "a:mid" } }),
      clientsListing([], [{ provider: "a", reason: "connection refused" }]),
    );
    expect(checks).toHaveLength(0);
  });

  it("leaves malformed and unknown-provider references to the pure checks", async () => {
    const checks = await evaluateModelListingHealth(
      configured({ shortcuts: { text: { bare: "no-colon" } }, delegates: { deep: "missing:big" } }),
      clientsListing([]),
    );
    expect(checks).toHaveLength(0);
  });

  it("never fetches the listing when nothing resolvable is configured", async () => {
    const clients = clientsListing([]);
    clients.listModels = () => {
      throw new Error("listing should not be fetched");
    };
    const checks = await evaluateModelListingHealth(
      result({ models: { shortcuts: {}, delegates: {} } }),
      clients,
    );
    expect(checks).toHaveLength(0);
  });

  it("stays silent when every reference is listed", async () => {
    const checks = await evaluateModelListingHealth(
      configured({ shortcuts: { text: { flash: "a:small" } }, delegates: { daily: "a:small" } }),
      clientsListing([{ id: "a:small", provider: "a" }]),
    );
    expect(checks).toHaveLength(0);
  });
});
