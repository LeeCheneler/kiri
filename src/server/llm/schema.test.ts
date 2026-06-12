import { describe, expect, it } from "bun:test";
import { llmProvidersSchema } from "./schema.ts";

describe("llmProvidersSchema", () => {
  it("parses an empty config (no providers key)", () => {
    const result = llmProvidersSchema.parse({});
    expect(result.providers).toBeUndefined();
  });

  it("parses an empty providers map", () => {
    const result = llmProvidersSchema.parse({ providers: {} });
    expect(result.providers).toEqual({});
  });

  it("parses anthropic and openai providers without a base_url", () => {
    const result = llmProvidersSchema.parse({
      providers: { anthropic: { type: "anthropic" }, openai: { type: "openai" } },
    });
    expect(result.providers?.anthropic).toEqual({ type: "anthropic" });
    expect(result.providers?.openai).toEqual({ type: "openai" });
  });

  it("parses a custom-named provider with an explicit type and api_key ref", () => {
    const result = llmProvidersSchema.parse({
      providers: { "my-claude": { type: "anthropic", api_key: { env: "MY_KEY" } } },
    });
    expect(result.providers?.["my-claude"]).toEqual({
      type: "anthropic",
      api_key: { env: "MY_KEY" },
    });
  });

  it("parses an openai-compatible provider with a base_url", () => {
    const result = llmProvidersSchema.parse({
      providers: { local: { type: "openai-compatible", base_url: "http://localhost:1234/v1" } },
    });
    expect(result.providers?.local).toEqual({
      type: "openai-compatible",
      base_url: "http://localhost:1234/v1",
    });
  });

  it("requires an explicit type on every provider", () => {
    const result = llmProvidersSchema.safeParse({ providers: { anthropic: {} } });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["providers", "anthropic", "type"]);
  });

  it("rejects an unknown type value", () => {
    expect(() => llmProvidersSchema.parse({ providers: { x: { type: "gemini" } } })).toThrow();
  });

  it("rejects an openai-compatible provider without a base_url", () => {
    const result = llmProvidersSchema.safeParse({
      providers: { local: { type: "openai-compatible" } },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["providers", "local", "base_url"]);
  });

  it("rejects an empty base_url", () => {
    expect(() =>
      llmProvidersSchema.parse({
        providers: { local: { type: "openai-compatible", base_url: "" } },
      }),
    ).toThrow();
  });

  it("rejects a literal string api_key (env-ref form only)", () => {
    expect(() =>
      llmProvidersSchema.parse({
        providers: { anthropic: { type: "anthropic", api_key: "sk-123" } },
      }),
    ).toThrow();
  });

  it("rejects an api_key env ref with an empty var name", () => {
    expect(() =>
      llmProvidersSchema.parse({
        providers: { anthropic: { type: "anthropic", api_key: { env: "" } } },
      }),
    ).toThrow();
  });

  it("rejects an api_key env ref carrying extra keys", () => {
    expect(() =>
      llmProvidersSchema.parse({
        providers: { anthropic: { type: "anthropic", api_key: { env: "X", extra: 1 } } },
      }),
    ).toThrow();
  });

  it("rejects an empty provider name", () => {
    expect(() => llmProvidersSchema.parse({ providers: { "": { type: "anthropic" } } })).toThrow();
  });

  it("rejects an unknown top-level key (strict)", () => {
    expect(() => llmProvidersSchema.parse({ providers: {}, junk: true })).toThrow();
  });

  it("rejects an unknown provider-entry key (strict)", () => {
    expect(() =>
      llmProvidersSchema.parse({ providers: { anthropic: { type: "anthropic", junk: true } } }),
    ).toThrow();
  });
});
