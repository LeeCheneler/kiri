import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ConfigStore, createConfigStore } from "../config/store.ts";
import { loadLlmProviders } from "./loader.ts";

const write = (cwd: string, yaml: string): void =>
  writeFileSync(join(cwd, "llm-providers.yaml"), yaml);

describe("loadLlmProviders", () => {
  let cwd: string;
  let config: ConfigStore;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-llm-"));
    config = createConfigStore(cwd);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("returns an empty registry when the file is absent (not a failure)", () => {
    const result = loadLlmProviders(config, {});
    expect(result.providers.size).toBe(0);
    expect(result.failure).toBeUndefined();
  });

  it("returns an empty registry for an empty providers map", () => {
    write(cwd, "providers: {}\n");
    const result = loadLlmProviders(config, {});
    expect(result.providers.size).toBe(0);
    expect(result.failure).toBeUndefined();
  });

  it("hydrates a provider with a declared api_key env ref", () => {
    write(
      cwd,
      `providers:
  anthropic:
    type: anthropic
    api_key:
      env: MY_KEY
`,
    );
    const result = loadLlmProviders(config, { MY_KEY: "secret" });
    expect(result.failure).toBeUndefined();
    expect(result.providers.get("anthropic")).toEqual({
      name: "anthropic",
      type: "anthropic",
      baseUrl: undefined,
      apiKeyEnv: "MY_KEY",
    });
  });

  it("falls back to the conventional env var name without requiring it to be set", () => {
    write(
      cwd,
      `providers:
  anthropic:
    type: anthropic
  openai:
    type: openai
`,
    );
    const result = loadLlmProviders(config, {});
    expect(result.failure).toBeUndefined();
    expect(result.providers.get("anthropic")?.apiKeyEnv).toBe("ANTHROPIC_API_KEY");
    expect(result.providers.get("openai")?.apiKeyEnv).toBe("OPENAI_API_KEY");
  });

  it("hydrates an openai-compatible provider with no api key", () => {
    write(
      cwd,
      `providers:
  local:
    type: openai-compatible
    base_url: http://localhost:1234/v1
`,
    );
    const result = loadLlmProviders(config, {});
    expect(result.failure).toBeUndefined();
    expect(result.providers.get("local")).toEqual({
      name: "local",
      type: "openai-compatible",
      baseUrl: "http://localhost:1234/v1",
      apiKeyEnv: undefined,
    });
  });

  it("fails load when a declared env ref is missing, naming the offending key", () => {
    write(
      cwd,
      `providers:
  anthropic:
    type: anthropic
    api_key:
      env: MISSING_KEY
`,
    );
    const result = loadLlmProviders(config, {});
    expect(result.providers.size).toBe(0);
    expect(result.failure?.path).toBe(join(cwd, "llm-providers.yaml"));
    expect(result.failure?.reason).toContain("anthropic");
    expect(result.failure?.reason).toContain("MISSING_KEY");
  });

  it("stores the env var name, never the resolved secret value", () => {
    write(
      cwd,
      `providers:
  anthropic:
    type: anthropic
    api_key:
      env: MY_KEY
`,
    );
    const result = loadLlmProviders(config, { MY_KEY: "super-secret-value" });
    expect(result.providers.get("anthropic")?.apiKeyEnv).toBe("MY_KEY");
    expect(JSON.stringify(result.providers.get("anthropic"))).not.toContain("super-secret-value");
  });

  it("fails load when api_key is a literal string (schema rejection)", () => {
    write(
      cwd,
      `providers:
  anthropic:
    type: anthropic
    api_key: sk-literal
`,
    );
    const result = loadLlmProviders(config, {});
    expect(result.providers.size).toBe(0);
    expect(result.failure).toBeDefined();
  });

  it("fails load when openai-compatible omits base_url (schema rejection)", () => {
    write(
      cwd,
      `providers:
  local:
    type: openai-compatible
`,
    );
    const result = loadLlmProviders(config, {});
    expect(result.providers.size).toBe(0);
    expect(result.failure).toBeDefined();
  });

  it("fails load on a YAML parse error", () => {
    write(cwd, "providers: {\n");
    const result = loadLlmProviders(config, {});
    expect(result.providers.size).toBe(0);
    expect(result.failure?.reason.length).toBeGreaterThan(0);
  });

  it("fails load when the YAML is not an object", () => {
    write(cwd, "just a string\n");
    const result = loadLlmProviders(config, {});
    expect(result.providers.size).toBe(0);
    expect(result.failure).toBeDefined();
  });

  it("fails load when the path exists but can't be read as a file", () => {
    // A directory at the config path: existsSync is true, readFileSync throws.
    mkdirSync(join(cwd, "llm-providers.yaml"));
    const result = loadLlmProviders(config, {});
    expect(result.providers.size).toBe(0);
    expect(result.failure?.reason.length).toBeGreaterThan(0);
  });
});
