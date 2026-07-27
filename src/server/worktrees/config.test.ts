import { describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveWorktreeConfig, resolveWorktreeRoots } from "./config.ts";
import type { WorktreesConfig } from "./schema.ts";

describe("resolveWorktreeConfig", () => {
  it("falls back to the baseline when there is no config", () => {
    expect(resolveWorktreeConfig(undefined, "kiri")).toEqual({
      prepare: { env: null, install: "auto", postCreate: [] },
      cleanup: { mergedPr: "suggest", fetchIntervalMinutes: 0 },
    });
  });

  it("applies defaults over the baseline", () => {
    const worktrees: WorktreesConfig = {
      roots: [],
      defaults: {
        prepare: { env: "symlink", install: "off", postCreate: ["a"] },
        cleanup: { mergedPr: "auto", fetchIntervalMinutes: 30 },
      },
    };
    expect(resolveWorktreeConfig(worktrees, "kiri")).toEqual({
      prepare: { env: "symlink", install: "off", postCreate: ["a"] },
      cleanup: { mergedPr: "auto", fetchIntervalMinutes: 30 },
    });
  });

  it("deep-merges a repo override field-by-field over defaults", () => {
    const worktrees: WorktreesConfig = {
      roots: [],
      defaults: {
        prepare: { env: "symlink", install: "auto", postCreate: [] },
        cleanup: { mergedPr: "suggest", fetchIntervalMinutes: 10 },
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
    expect(resolved.cleanup).toEqual({ mergedPr: "suggest", fetchIntervalMinutes: 10 });
  });

  it("resolves an unknown repo key to defaults alone", () => {
    const worktrees: WorktreesConfig = {
      roots: [],
      defaults: { cleanup: { mergedPr: "off" } },
      repos: { kiri: { cleanup: { mergedPr: "auto" } } },
    };
    expect(resolveWorktreeConfig(worktrees, "other").cleanup.mergedPr).toBe("off");
  });

  it("lets a repo override cleanup independently of prepare", () => {
    const worktrees: WorktreesConfig = {
      roots: [],
      defaults: { prepare: { install: "off" } },
      repos: { kiri: { cleanup: { fetchIntervalMinutes: 5 } } },
    };
    const resolved = resolveWorktreeConfig(worktrees, "kiri");
    expect(resolved.prepare.install).toBe("off");
    expect(resolved.cleanup.fetchIntervalMinutes).toBe(5);
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
