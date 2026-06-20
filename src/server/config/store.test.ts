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
    expect(config.bundlesDir()).toBe(join(root, "scripts"));
    expect(config.bundleDir("daily")).toBe(join(root, "scripts", "daily"));
    expect(config.bundleRunPath("daily")).toBe(join(root, "scripts", "daily", "run.sh"));
  });

  it("derives the personas directory", () => {
    expect(config.personasDir()).toBe(join(root, "personas"));
  });

  it("derives the data directory and per-run scratch dirs", () => {
    expect(config.dataDir()).toBe(join(root, ".kiri"));
    expect(config.runDir("run-123")).toBe(join(root, ".kiri", "runs", "run-123"));
  });

  it("derives the instructions and providers files", () => {
    expect(config.instructionsFile()).toBe(join(root, "kiri.md"));
    expect(config.providersFile()).toBe(join(root, "llm-providers.yaml"));
  });
});
