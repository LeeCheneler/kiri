import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadKiriConfig } from "./loader.ts";
import { type ConfigStore, createConfigStore } from "./store.ts";

const write = (cwd: string, yaml: string): void => writeFileSync(join(cwd, "kiri.yaml"), yaml);

describe("loadKiriConfig", () => {
  let cwd: string;
  let config: ConfigStore;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-config-"));
    config = createConfigStore(cwd);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("returns an empty registry when the file is absent (not a failure)", () => {
    const result = loadKiriConfig(config, {});
    expect(result.providers.size).toBe(0);
    expect(result.failure).toBeUndefined();
  });

  it("returns an empty registry for an empty providers map", () => {
    write(cwd, "providers: {}\n");
    const result = loadKiriConfig(config, {});
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
    const result = loadKiriConfig(config, { MY_KEY: "secret" });
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
    const result = loadKiriConfig(config, {});
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
    const result = loadKiriConfig(config, {});
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
    const result = loadKiriConfig(config, {});
    expect(result.providers.size).toBe(0);
    expect(result.failure?.path).toBe(join(cwd, "kiri.yaml"));
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
    const result = loadKiriConfig(config, { MY_KEY: "super-secret-value" });
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
    const result = loadKiriConfig(config, {});
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
    const result = loadKiriConfig(config, {});
    expect(result.providers.size).toBe(0);
    expect(result.failure).toBeDefined();
  });

  it("fails load on a YAML parse error", () => {
    write(cwd, "providers: {\n");
    const result = loadKiriConfig(config, {});
    expect(result.providers.size).toBe(0);
    expect(result.failure?.reason.length).toBeGreaterThan(0);
  });

  it("fails load when the YAML is not an object", () => {
    write(cwd, "just a string\n");
    const result = loadKiriConfig(config, {});
    expect(result.providers.size).toBe(0);
    expect(result.failure).toBeDefined();
  });

  it("treats an empty or comment-only file as no config (not a failure)", () => {
    write(cwd, "# a commented starter kiri.yaml with nothing active\n");
    const result = loadKiriConfig(config, {});
    expect(result.providers.size).toBe(0);
    expect(result.failure).toBeUndefined();
  });

  it("fails load when the path exists but can't be read as a file", () => {
    // A directory at the config path: existsSync is true, readFileSync throws.
    mkdirSync(join(cwd, "kiri.yaml"));
    const result = loadKiriConfig(config, {});
    expect(result.providers.size).toBe(0);
    expect(result.failure?.reason.length).toBeGreaterThan(0);
  });

  it("loads providers from kiri.yml when only it exists", () => {
    writeFileSync(
      join(cwd, "kiri.yml"),
      "providers:\n  local:\n    type: openai-compatible\n    base_url: http://localhost:1234/v1\n",
    );
    const result = loadKiriConfig(config, {});
    expect(result.failure).toBeUndefined();
    expect(result.warning).toBeUndefined();
    expect(result.providers.get("local")?.type).toBe("openai-compatible");
  });

  it("prefers kiri.yaml and warns when both kiri.yaml and kiri.yml exist", () => {
    write(cwd, "providers:\n  anthropic:\n    type: anthropic\n");
    writeFileSync(join(cwd, "kiri.yml"), "providers:\n  openai:\n    type: openai\n");
    const result = loadKiriConfig(config, {});
    expect(result.failure).toBeUndefined();
    expect(result.providers.has("anthropic")).toBe(true);
    expect(result.providers.has("openai")).toBe(false);
    expect(result.warning).toContain("kiri.yaml");
    expect(result.warning).toContain("kiri.yml");
  });

  it("leaves mcp empty when there is no mcp key", () => {
    write(cwd, "providers: {}\n");
    const result = loadKiriConfig(config, {});
    expect(result.mcp.size).toBe(0);
    expect(result.mcpUnresolved).toEqual([]);
  });

  it("resolves a minimal stdio server with no env", () => {
    write(cwd, "mcp:\n  fs:\n    type: stdio\n    command: server\n");
    const result = loadKiriConfig(config, {});
    expect(result.failure).toBeUndefined();
    expect(result.mcp.get("fs")).toEqual({ name: "fs", type: "stdio", command: "server" });
  });

  it("resolves a stdio server, flattening env refs to var names", () => {
    write(
      cwd,
      `mcp:
  fs:
    type: stdio
    command: npx
    args: ["-y", "server"]
    env:
      TOKEN:
        env: FS_TOKEN
`,
    );
    const result = loadKiriConfig(config, { FS_TOKEN: "x" });
    expect(result.failure).toBeUndefined();
    expect(result.mcp.get("fs")).toEqual({
      name: "fs",
      type: "stdio",
      command: "npx",
      args: ["-y", "server"],
      envRefs: { TOKEN: "FS_TOKEN" },
    });
    expect(result.mcpUnresolved).toEqual([]);
  });

  it("resolves an http server, flattening header refs to var names", () => {
    write(
      cwd,
      `mcp:
  linear:
    type: http
    url: https://mcp.linear.app/mcp
    headers:
      Authorization:
        env: LINEAR_TOKEN
`,
    );
    const result = loadKiriConfig(config, { LINEAR_TOKEN: "x" });
    expect(result.mcp.get("linear")).toEqual({
      name: "linear",
      type: "http",
      url: "https://mcp.linear.app/mcp",
      headerRefs: { Authorization: "LINEAR_TOKEN" },
    });
  });

  it("excludes an mcp server whose env ref is unset without failing the load", () => {
    write(
      cwd,
      `mcp:
  linear:
    type: http
    url: https://mcp.linear.app/mcp
    headers:
      Authorization:
        env: LINEAR_TOKEN
`,
    );
    const result = loadKiriConfig(config, {});
    expect(result.failure).toBeUndefined();
    expect(result.mcp.size).toBe(0);
    expect(result.mcpUnresolved).toEqual([{ name: "linear", missing: ["LINEAR_TOKEN"] }]);
  });

  it("keeps providers loading when an mcp server's env ref is unset", () => {
    write(
      cwd,
      `providers:
  anthropic:
    type: anthropic
    api_key:
      env: A_KEY
mcp:
  linear:
    type: http
    url: https://mcp.linear.app/mcp
    headers:
      Authorization:
        env: LINEAR_TOKEN
`,
    );
    const result = loadKiriConfig(config, { A_KEY: "x" });
    expect(result.failure).toBeUndefined();
    expect(result.providers.has("anthropic")).toBe(true);
    expect(result.mcp.size).toBe(0);
    expect(result.mcpUnresolved.map((u) => u.name)).toEqual(["linear"]);
  });
});
