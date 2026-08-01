import { describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveWorktreeConfig, resolveWorktreeRoots } from "./config.ts";
import type { WorktreesConfig } from "./schema.ts";

describe("resolveWorktreeConfig", () => {
  it("falls back to the baseline when there is no config", () => {
    expect(resolveWorktreeConfig(undefined, "kiri")).toEqual({
      prepare: { env: null, install: "auto", postCreate: [] },
    });
  });

  it("applies defaults over the baseline", () => {
    const worktrees: WorktreesConfig = {
      roots: [],
      defaults: {
        prepare: { env: "symlink", install: "off", postCreate: ["a"] },
      },
    };
    expect(resolveWorktreeConfig(worktrees, "kiri")).toEqual({
      prepare: { env: "symlink", install: "off", postCreate: ["a"] },
    });
  });

  it("deep-merges a repo override field-by-field over defaults", () => {
    const worktrees: WorktreesConfig = {
      roots: [],
      defaults: {
        prepare: { env: "symlink", install: "auto", postCreate: [] },
      },
      repos: { kiri: { prepare: { postCreate: ["mise trust"] } } },
    };
    const resolved = resolveWorktreeConfig(worktrees, "kiri");
    // Overridden field wins; unspecified sibling fields keep the default.
    expect(resolved.prepare).toEqual({
      env: "symlink",
      install: "auto",
      postCreate: ["mise trust"],
    });
  });

  it("resolves an unknown repo key to defaults alone", () => {
    const worktrees: WorktreesConfig = {
      roots: [],
      defaults: { prepare: { install: "off" } },
      repos: { kiri: { prepare: { install: "auto" } } },
    };
    expect(resolveWorktreeConfig(worktrees, "other").prepare.install).toBe("off");
  });
});

describe("resolveWorktreeRoots", () => {
  const cwd = "/workspace";

  it("returns no roots when the section is absent", () => {
    expect(resolveWorktreeRoots(undefined, cwd)).toEqual([]);
  });

  it("resolves a relative root against cwd", () => {
    expect(resolveWorktreeRoots({ roots: ["repos"] }, cwd)).toEqual(["/workspace/repos"]);
  });

  it("keeps an absolute root as-is", () => {
    expect(resolveWorktreeRoots({ roots: ["/srv/code"] }, cwd)).toEqual(["/srv/code"]);
  });

  it("expands a leading ~ to the home directory", () => {
    expect(resolveWorktreeRoots({ roots: ["~/projects"] }, cwd)).toEqual([
      join(homedir(), "projects"),
    ]);
  });

  it("expands a bare ~ to the home directory", () => {
    expect(resolveWorktreeRoots({ roots: ["~"] }, cwd)).toEqual([homedir()]);
  });
});
