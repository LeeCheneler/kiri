import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { GitConfig } from "./schema.ts";

/** Fully-resolved prepare policy — every field settled to a concrete value. */
export interface ResolvedWorktreePrepare {
  /** How to seed .env files, or null to leave them untouched. */
  env: "symlink" | "copy" | null;
  /** Whether to install dependencies after create. */
  install: "auto" | "off";
  /** Commands to run in the new worktree, after env files are seeded and before installs. */
  postCreate: string[];
}

/** A repo's effective worktree policy after merging its overrides over defaults. */
export interface ResolvedWorktreeConfig {
  prepare: ResolvedWorktreePrepare;
}

// Baseline settings applied when neither `defaults` nor a repo override supplies
// a value. `env` has no baseline — an unset env means "leave .env files alone".
const BASELINE: ResolvedWorktreeConfig = {
  prepare: { env: null, install: "auto", postCreate: [] },
};

// Expand a leading `~` to the user's home directory. `~user` forms are not
// supported and resolve as ordinary workspace-relative paths.
const expandHome = (dir: string): string => {
  if (dir === "~") return homedir();
  if (dir.startsWith("~/")) return join(homedir(), dir.slice(2));
  return dir;
};

/**
 * Resolve the effective worktree policy for a repo by deep-merging its `repos`
 * override over `defaults` over the built-in baseline, field by field. `repoKey`
 * is the repo's directory name (the `repos:` map key); an unknown key resolves
 * to defaults alone. Returns a fully-settled prepare policy so operations never
 * re-implement the merge.
 */
export function resolveWorktreeConfig(
  git: GitConfig | undefined,
  repoKey: string,
): ResolvedWorktreeConfig {
  const defaults = git?.defaults;
  const repo = git?.repos?.[repoKey];
  return {
    prepare: {
      env: repo?.prepare?.env ?? defaults?.prepare?.env ?? BASELINE.prepare.env,
      install: repo?.prepare?.install ?? defaults?.prepare?.install ?? BASELINE.prepare.install,
      postCreate:
        repo?.prepare?.postCreate ?? defaults?.prepare?.postCreate ?? BASELINE.prepare.postCreate,
    },
  };
}

/**
 * Resolve the configured `roots` to absolute directories to scan. A leading `~`
 * expands to the home directory and a relative entry resolves against `cwd` (the
 * workspace root). An absent `git:` section yields no roots.
 */
export function resolveWorktreeRoots(git: GitConfig | undefined, cwd: string): string[] {
  return (git?.roots ?? []).map((root) => resolve(cwd, expandHome(root)));
}
