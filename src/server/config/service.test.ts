import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfigService } from "./service.ts";
import { type ConfigStore, createConfigStore } from "./store.ts";

const VALID = `providers:
  local:
    type: openai-compatible
    base_url: http://localhost:1234/v1
mcp:
  docs:
    type: http
    url: https://example.com/mcp
models:
  shortcuts:
    text:
      fast: local:small
filesystem:
  allowed_directories: [notes]
`;

describe("createConfigService", () => {
  let cwd: string;
  let config: ConfigStore;
  const write = (yaml: string, name = "kiri.yaml"): void => writeFileSync(join(cwd, name), yaml);

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-config-service-"));
    mkdirSync(join(cwd, "notes"));
    config = createConfigStore(cwd);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("serves an empty snapshot, without a failure, when there is no config file", () => {
    const snapshot = createConfigService(config, {}).current();
    expect(snapshot.revision).toBe(1);
    expect(snapshot.providers.size).toBe(0);
    expect(snapshot.mcp.size).toBe(0);
    expect(snapshot.models).toEqual({ shortcuts: {}, delegates: {} });
    expect(snapshot.filesystem).toEqual({ allowedDirectories: [] });
    expect(snapshot.diagnostics).toEqual({ mcpUnresolved: [] });
  });

  it("serves every section from one load", () => {
    write(VALID);
    const snapshot = createConfigService(config, {}).current();
    expect([...snapshot.providers.keys()]).toEqual(["local"]);
    expect([...snapshot.mcp.keys()]).toEqual(["docs"]);
    expect(snapshot.models.shortcuts).toEqual({ text: { fast: "local:small" } });
    expect(snapshot.filesystem).toEqual({
      allowedDirectories: [join(cwd, "notes")],
      defaultWorkingDirectory: join(cwd, "notes"),
    });
    expect(snapshot.diagnostics).toEqual({ mcpUnresolved: [] });
  });

  it("serves the same snapshot until the file changes, then a later revision", () => {
    write(VALID);
    const service = createConfigService(config, {});
    const first = service.current();
    expect(service.current()).toBe(first);

    write(VALID.replace("fast: local:small", "slow: local:big-model"));
    const second = service.current();
    expect(second.revision).toBeGreaterThan(first.revision);
    expect(second.models.shortcuts).toEqual({ text: { slow: "local:big-model" } });
    // The earlier snapshot is untouched by the edit.
    expect(first.models.shortcuts).toEqual({ text: { fast: "local:small" } });
  });

  it("picks up a config file created after startup", () => {
    const service = createConfigService(config, {});
    expect(service.current().providers.size).toBe(0);
    write(VALID);
    expect([...service.current().providers.keys()]).toEqual(["local"]);
  });

  it("keeps connectivity and models but closes the sandbox on an invalid edit", () => {
    write(VALID);
    const service = createConfigService(config, {});
    service.current();

    write("providers: [not, a, map]\n");
    const broken = service.current();
    expect([...broken.providers.keys()]).toEqual(["local"]);
    expect([...broken.mcp.keys()]).toEqual(["docs"]);
    expect(broken.models.shortcuts).toEqual({ text: { fast: "local:small" } });
    expect(broken.filesystem).toEqual({ allowedDirectories: [] });
    expect(broken.diagnostics.failure?.path).toBe(join(cwd, "kiri.yaml"));

    // A second invalid edit still serves the last *good* connectivity.
    write("providers: [still, not, a, map]\n");
    expect([...service.current().providers.keys()]).toEqual(["local"]);

    write(VALID);
    const fixed = service.current();
    expect(fixed.diagnostics.failure).toBeUndefined();
    expect(fixed.filesystem.allowedDirectories).toEqual([join(cwd, "notes")]);
  });

  it("serves nothing, with the failure, when the first load is invalid", () => {
    write("providers: [not, a, map]\n");
    const snapshot = createConfigService(config, {}).current();
    expect(snapshot.providers.size).toBe(0);
    expect(snapshot.diagnostics.failure).toBeDefined();
  });

  it("reports the latest load's warning and unresolved MCP servers", () => {
    write(
      "mcp:\n  tracker:\n    type: http\n    url: https://example.com/mcp\n    headers:\n      Authorization: { env: TRACKER_TOKEN }\n",
    );
    write("providers: {}\n", "kiri.yml");
    const { diagnostics } = createConfigService(config, {}).current();
    expect(diagnostics.warning).toContain("kiri.yml");
    expect(diagnostics.mcpUnresolved).toEqual([{ name: "tracker", missing: ["TRACKER_TOKEN"] }]);
  });

  it("loads again on reload even when the file is unchanged", () => {
    write(VALID);
    const service = createConfigService(config, {});
    const first = service.current();
    const reloaded = service.reload();
    expect(reloaded.revision).toBe(first.revision + 1);
    expect(service.current()).toBe(reloaded);
  });

  it("serves snapshots that cannot be modified", () => {
    write(VALID);
    const snapshot = createConfigService(config, {}).current();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.filesystem.allowedDirectories)).toBe(true);
    expect(Object.isFrozen(snapshot.models)).toBe(true);
  });
});
