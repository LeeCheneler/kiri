import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createConfigStore } from "./store.ts";

describe("createConfigStore", () => {
  const root = "/work/space";
  const config = createConfigStore(root);

  it("exposes the workspace root", () => {
    expect(config.cwd()).toBe(root);
  });

  it("derives the workflows directory", () => {
    expect(config.workflowsDir()).toBe(join(root, "workflows"));
  });

  it("derives the bundles directory and per-bundle paths", () => {
    expect(config.bundlesDir()).toBe(join(root, "bundles"));
    expect(config.bundleDir("daily")).toBe(join(root, "bundles", "daily"));
    expect(config.bundleRunPath("daily")).toBe(join(root, "bundles", "daily", "run.sh"));
  });

  it("derives the data directory and per-run scratch dirs", () => {
    expect(config.dataDir()).toBe(join(root, ".kiri"));
    expect(config.runDir("run-123")).toBe(join(root, ".kiri", "runs", "run-123"));
  });

  it("derives the mcp credentials file under the data dir", () => {
    expect(config.mcpCredentialsFile()).toBe(join(root, ".kiri", "mcp-credentials.json"));
  });

  it("derives the tool permissions file under the data dir", () => {
    expect(config.toolPermissionsFile()).toBe(join(root, ".kiri", "tool-permissions.json"));
  });

  it("derives the instructions and config files", () => {
    expect(config.instructionsFile()).toBe(join(root, "kiri.md"));
    expect(config.configFile()).toBe(join(root, "kiri.yaml"));
    expect(config.configFiles()).toEqual([join(root, "kiri.yaml"), join(root, "kiri.yml")]);
  });

  it("derives the workspace env file", () => {
    expect(config.envFile()).toBe(join(root, ".env"));
  });
});
