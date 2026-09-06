import { describe, expect, it } from "bun:test";
import { configuredDelegateRoles, kiriConfigSchema } from "./schema.ts";

describe("kiriConfigSchema", () => {
  it("parses an empty config (no providers key)", () => {
    const result = kiriConfigSchema.parse({});
    expect(result.providers).toBeUndefined();
  });

  it("parses an empty providers map", () => {
    const result = kiriConfigSchema.parse({ providers: {} });
    expect(result.providers).toEqual({});
  });

  it("parses anthropic and openai providers without a base_url", () => {
    const result = kiriConfigSchema.parse({
      providers: { anthropic: { type: "anthropic" }, openai: { type: "openai" } },
    });
    expect(result.providers?.anthropic).toEqual({ type: "anthropic" });
    expect(result.providers?.openai).toEqual({ type: "openai" });
  });

  it("parses a custom-named provider with an explicit type and api_key ref", () => {
    const result = kiriConfigSchema.parse({
      providers: { "my-claude": { type: "anthropic", api_key: { env: "MY_KEY" } } },
    });
    expect(result.providers?.["my-claude"]).toEqual({
      type: "anthropic",
      api_key: { env: "MY_KEY" },
    });
  });

  it("parses an openai-compatible provider with a base_url", () => {
    const result = kiriConfigSchema.parse({
      providers: { local: { type: "openai-compatible", base_url: "http://localhost:1234/v1" } },
    });
    expect(result.providers?.local).toEqual({
      type: "openai-compatible",
      base_url: "http://localhost:1234/v1",
    });
  });

  it("parses an mcp servers map", () => {
    const result = kiriConfigSchema.parse({
      mcp: { fs: { type: "stdio", command: "npx", args: ["-y", "server"] } },
    });
    expect(result.mcp?.fs).toEqual({ type: "stdio", command: "npx", args: ["-y", "server"] });
  });

  it("parses providers and mcp together", () => {
    const result = kiriConfigSchema.parse({
      providers: { anthropic: { type: "anthropic" } },
      mcp: { linear: { type: "http", url: "https://mcp.linear.app/mcp" } },
    });
    expect(result.providers?.anthropic).toEqual({ type: "anthropic" });
    expect(result.mcp?.linear).toEqual({ type: "http", url: "https://mcp.linear.app/mcp" });
  });

  it("leaves mcp undefined when the key is absent", () => {
    expect(kiriConfigSchema.parse({}).mcp).toBeUndefined();
  });

  it("requires an explicit type on every provider", () => {
    const result = kiriConfigSchema.safeParse({ providers: { anthropic: {} } });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["providers", "anthropic", "type"]);
  });

  it("rejects an unknown type value", () => {
    expect(() => kiriConfigSchema.parse({ providers: { x: { type: "gemini" } } })).toThrow();
  });

  it("rejects an openai-compatible provider without a base_url", () => {
    const result = kiriConfigSchema.safeParse({
      providers: { local: { type: "openai-compatible" } },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["providers", "local", "base_url"]);
  });

  it("rejects an empty base_url", () => {
    expect(() =>
      kiriConfigSchema.parse({
        providers: { local: { type: "openai-compatible", base_url: "" } },
      }),
    ).toThrow();
  });

  it("rejects a literal string api_key (env-ref form only)", () => {
    expect(() =>
      kiriConfigSchema.parse({
        providers: { anthropic: { type: "anthropic", api_key: "sk-123" } },
      }),
    ).toThrow();
  });

  it("rejects an api_key env ref with an empty var name", () => {
    expect(() =>
      kiriConfigSchema.parse({
        providers: { anthropic: { type: "anthropic", api_key: { env: "" } } },
      }),
    ).toThrow();
  });

  it("rejects an api_key env ref carrying extra keys", () => {
    expect(() =>
      kiriConfigSchema.parse({
        providers: { anthropic: { type: "anthropic", api_key: { env: "X", extra: 1 } } },
      }),
    ).toThrow();
  });

  it("rejects an empty provider name", () => {
    expect(() => kiriConfigSchema.parse({ providers: { "": { type: "anthropic" } } })).toThrow();
  });

  it("parses a filesystem section with allowed directories", () => {
    const result = kiriConfigSchema.parse({
      filesystem: { allowed_directories: [".", "/srv/notes"] },
    });
    expect(result.filesystem).toEqual({ allowed_directories: [".", "/srv/notes"] });
  });

  it("parses an empty allowed_directories list (same as an absent section)", () => {
    const result = kiriConfigSchema.parse({ filesystem: { allowed_directories: [] } });
    expect(result.filesystem?.allowed_directories).toEqual([]);
  });

  it("leaves filesystem undefined when the key is absent", () => {
    expect(kiriConfigSchema.parse({}).filesystem).toBeUndefined();
  });

  it("requires allowed_directories on a filesystem section", () => {
    const result = kiriConfigSchema.safeParse({ filesystem: {} });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["filesystem", "allowed_directories"]);
  });

  it("rejects an empty directory entry", () => {
    expect(() => kiriConfigSchema.parse({ filesystem: { allowed_directories: [""] } })).toThrow();
  });

  it("parses a filesystem section with a default working directory", () => {
    const result = kiriConfigSchema.parse({
      filesystem: { allowed_directories: ["."], default_working_directory: "notes" },
    });
    expect(result.filesystem?.default_working_directory).toBe("notes");
  });

  it("leaves default_working_directory undefined when the key is absent", () => {
    const result = kiriConfigSchema.parse({ filesystem: { allowed_directories: ["."] } });
    expect(result.filesystem?.default_working_directory).toBeUndefined();
  });

  it("rejects an empty default_working_directory", () => {
    expect(() =>
      kiriConfigSchema.parse({
        filesystem: { allowed_directories: ["."], default_working_directory: "" },
      }),
    ).toThrow();
  });

  it("rejects an unknown filesystem key (strict)", () => {
    expect(() =>
      kiriConfigSchema.parse({ filesystem: { allowed_directories: ["."], junk: true } }),
    ).toThrow();
  });

  it("rejects the retired shell section (strict)", () => {
    const result = kiriConfigSchema.safeParse({ shell: { working_directories: ["."] } });
    expect(result.success).toBe(false);
  });

  it("parses a models section with shortcuts, delegates, utility, and transcription", () => {
    const result = kiriConfigSchema.parse({
      models: {
        shortcuts: {
          text: { sonnet: "a:mid", haiku: "a:small" },
          image: { images: "b:img" },
        },
        delegates: { quick: "a:small", daily: "a:mid", deep: "a:big" },
        utility: "a:small",
        transcription: "b:whisper",
      },
    });
    expect(result.models?.shortcuts?.text).toEqual({ sonnet: "a:mid", haiku: "a:small" });
    expect(result.models?.shortcuts?.image).toEqual({ images: "b:img" });
    expect(result.models?.delegates).toEqual({ quick: "a:small", daily: "a:mid", deep: "a:big" });
    expect(result.models?.utility).toBe("a:small");
    expect(result.models?.transcription).toBe("b:whisper");
  });

  it("parses shortcuts with only one modality", () => {
    const result = kiriConfigSchema.parse({
      models: { shortcuts: { text: { sonnet: "a:mid" } } },
    });
    expect(result.models?.shortcuts?.image).toBeUndefined();
  });

  it("parses a subset of delegate roles", () => {
    const result = kiriConfigSchema.parse({
      models: { delegates: { daily: "a:mid" } },
    });
    expect(result.models?.delegates).toEqual({ daily: "a:mid" });
  });

  it("leaves models undefined when the key is absent", () => {
    expect(kiriConfigSchema.parse({}).models).toBeUndefined();
  });

  it("rejects an empty shortcut reference", () => {
    expect(() =>
      kiriConfigSchema.parse({ models: { shortcuts: { text: { sonnet: "" } } } }),
    ).toThrow();
  });

  it("rejects an empty delegate reference", () => {
    expect(() => kiriConfigSchema.parse({ models: { delegates: { daily: "" } } })).toThrow();
  });

  it("rejects an unknown delegate role (strict)", () => {
    expect(() =>
      kiriConfigSchema.parse({
        models: { delegates: { daily: "a:mid", katana: "a:x" } },
      }),
    ).toThrow();
  });

  it("rejects an unknown shortcuts modality (strict)", () => {
    expect(() =>
      kiriConfigSchema.parse({
        models: { shortcuts: { audio: { whisper: "a:audio" } } },
      }),
    ).toThrow();
  });

  it("rejects an unknown models key (strict)", () => {
    expect(() =>
      kiriConfigSchema.parse({
        models: { text: { tanto: "a:s" } },
      }),
    ).toThrow();
  });

  it("rejects an unknown top-level key (strict)", () => {
    expect(() => kiriConfigSchema.parse({ providers: {}, junk: true })).toThrow();
  });

  it("rejects an unknown provider-entry key (strict)", () => {
    expect(() =>
      kiriConfigSchema.parse({ providers: { anthropic: { type: "anthropic", junk: true } } }),
    ).toThrow();
  });
});

describe("configuredDelegateRoles", () => {
  it("returns the configured roles, lightest first", () => {
    expect(configuredDelegateRoles({ deep: "a:big", quick: "a:small" })).toEqual(["quick", "deep"]);
  });

  it("returns every role when all are configured", () => {
    expect(configuredDelegateRoles({ quick: "a:s", daily: "a:m", deep: "a:b" })).toEqual([
      "quick",
      "daily",
      "deep",
    ]);
  });

  it("returns no roles for an empty or absent config", () => {
    expect(configuredDelegateRoles({})).toEqual([]);
    expect(configuredDelegateRoles(undefined)).toEqual([]);
  });
});

describe("Codex provider configuration", () => {
  it("accepts subscription auth without key or URL", () => {
    expect(
      kiriConfigSchema.parse({ providers: { chatgpt: { type: "openai-codex" } } }).providers
        ?.chatgpt,
    ).toEqual({ type: "openai-codex" });
  });
  it.each([{ api_key: { env: "OPENAI_API_KEY" } }, { base_url: "https://api.openai.com/v1" }])(
    "rejects API configuration on a subscription provider",
    (extra) => {
      expect(() =>
        kiriConfigSchema.parse({ providers: { chatgpt: { type: "openai-codex", ...extra } } }),
      ).toThrow();
    },
  );
});
