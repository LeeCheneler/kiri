import { spawnSync } from "node:child_process";

/**
 * Snapshot of the data repo's git state at run-start. Both fields are
 * null when `cwd` is not a git working tree (or has no commits yet) so
 * the absence of git is a first-class state, not an error.
 */
export interface GitHead {
  sha: string | null;
  dirty: boolean | null;
}

/**
 * Resolve the HEAD commit and dirty flag for `cwd`. Returns `{ sha:
 * null, dirty: null }` when git is unavailable, `cwd` is outside a
 * working tree, or HEAD has no commit. Synchronous because run-start
 * already serialises on a few short DB writes; one git invocation is in
 * the same budget.
 */
export function resolveGitHead(cwd: string): GitHead {
  const rev = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
  if (rev.status !== 0) return { sha: null, dirty: null };
  const sha = rev.stdout.trim();
  if (sha.length === 0) return { sha: null, dirty: null };

  const status = spawnSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
  // If `rev-parse` succeeded then `status` should too; if it doesn't,
  // fall back to `dirty: null` rather than guessing clean.
  const dirty = status.status === 0 ? status.stdout.length > 0 : null;
  return { sha, dirty };
}
