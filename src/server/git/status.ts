import type { WorktreeEntry } from "./discovery.ts";
import { runGit } from "./run.ts";

/**
 * Live status of a single worktree: its structural facts from discovery plus
 * the working-tree state computed on demand — dirty flag and ahead/behind
 * against its upstream. Read-only; never fetches.
 */
export interface WorktreeStatus {
  /** Absolute path of the worktree's root directory. */
  path: string;
  /** Short branch name, or null when detached or bare. */
  branch: string | null;
  /** Whether HEAD is detached (no branch). */
  detached: boolean;
  /** HEAD commit sha, or null for a bare repo with no checkout. */
  head: string | null;
  /** Whether the working tree has uncommitted changes (tracked or untracked). */
  dirty: boolean;
  /** Commits on the branch not on its upstream; 0 when there is no upstream. */
  ahead: number;
  /** Commits on the upstream not on the branch; 0 when there is no upstream. */
  behind: number;
  /** Whether the branch's configured upstream no longer exists. */
  upstreamGone: boolean;
  /** Whether the worktree is locked against pruning. */
  locked: boolean;
  /** Whether git considers the worktree prunable. */
  prunable: boolean;
  /** Whether this is the repo's primary checkout. */
  primary: boolean;
}

// Whether the worktree at `path` has uncommitted changes. A bare or missing
// checkout reports clean.
const isDirty = async (path: string): Promise<boolean> => {
  const result = await runGit(path, "status", "--porcelain");
  return result.ok && result.stdout.length > 0;
};

// Commits the branch is ahead/behind its upstream. Called only when the branch
// has a live upstream, so `@{upstream}` resolves and the output is "<behind>\t<ahead>".
const aheadBehind = async (path: string): Promise<{ ahead: number; behind: number }> => {
  const result = await runGit(path, "rev-list", "--left-right", "--count", "@{upstream}...HEAD");
  const [behind = 0, ahead = 0] = result.stdout.trim().split(/\s+/).map(Number);
  return { ahead, behind };
};

// Upstream tracking state for `entry`. A detached/bare worktree or a branch
// with no upstream has none; a deleted upstream reads `[gone]`; otherwise
// ahead/behind are counted.
const trackingState = async (
  entry: WorktreeEntry,
): Promise<{ ahead: number; behind: number; upstreamGone: boolean }> => {
  if (entry.branch === null) return { ahead: 0, behind: 0, upstreamGone: false };

  const result = await runGit(
    entry.path,
    "for-each-ref",
    "--format=%(upstream:track)",
    `refs/heads/${entry.branch}`,
  );
  const track = result.ok ? result.stdout.trim() : "";
  if (track === "[gone]") return { ahead: 0, behind: 0, upstreamGone: true };
  if (track === "") return { ahead: 0, behind: 0, upstreamGone: false };
  return { ...(await aheadBehind(entry.path)), upstreamGone: false };
};

/**
 * Compute the live status of a discovered worktree: its dirty flag and upstream
 * ahead/behind, carried alongside the structural flags (branch, detached,
 * locked, prunable, primary) from discovery. Read-only — runs `git status`,
 * `git for-each-ref`, and `git rev-list`, never a fetch.
 */
export async function worktreeStatus(entry: WorktreeEntry): Promise<WorktreeStatus> {
  const { ahead, behind, upstreamGone } = await trackingState(entry);
  const dirty = await isDirty(entry.path);
  return {
    path: entry.path,
    branch: entry.branch,
    detached: entry.detached,
    head: entry.head,
    dirty,
    ahead,
    behind,
    upstreamGone,
    locked: entry.locked,
    prunable: entry.prunable,
    primary: entry.primary,
  };
}
