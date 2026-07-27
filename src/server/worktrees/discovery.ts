import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * One worktree parsed from `git worktree list --porcelain`: the primary
 * checkout or one of its linked worktrees. Structural facts only — live
 * working-tree state (dirty, ahead/behind) is computed separately by
 * {@link ./status.ts}.
 */
export interface WorktreeEntry {
  /** Absolute path of the worktree's root directory. */
  path: string;
  /** HEAD commit sha, or null for a bare repo with no checkout. */
  head: string | null;
  /** Short branch name, or null when detached or bare. */
  branch: string | null;
  /** Whether this is a bare repo (no working tree). */
  bare: boolean;
  /** Whether HEAD is detached (no branch). */
  detached: boolean;
  /** Whether the worktree is locked against pruning. */
  locked: boolean;
  /** Reason given when locking, if any. */
  lockedReason: string | null;
  /** Whether git considers the worktree prunable (its gitdir is stale). */
  prunable: boolean;
  /** Reason git reports for prunability, if any. */
  prunableReason: string | null;
  /** Whether this is the repo's primary checkout (listed first by git). */
  primary: boolean;
}

/**
 * A git repo discovered under a scanned root: its primary checkout plus every
 * linked worktree, grouped by the shared git directory so worktrees living
 * outside the scanned roots still resolve to their repo.
 */
export interface DiscoveredRepo {
  /** Absolute path of the primary checkout. */
  root: string;
  /** Absolute `git rev-parse --git-common-dir` — the identity used to dedupe repos. */
  gitCommonDir: string;
  /** The primary checkout plus all linked worktrees. */
  worktrees: WorktreeEntry[];
}

// A short branch name from a full ref: refs/heads/foo → foo, anything else
// (e.g. an unusual symbolic ref) passed through unchanged.
const shortBranch = (ref: string): string =>
  ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;

/**
 * Parse `git worktree list --porcelain` output into structured entries. The
 * first entry is git's primary worktree, flagged `primary`.
 */
function parseWorktreePorcelain(stdout: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  // Records are separated by a blank line; the trailing blank yields an empty
  // block that is skipped.
  for (const block of stdout.split("\n\n")) {
    const lines = block.split("\n").filter((line) => line.length > 0);
    if (lines.length === 0) continue;

    const entry: WorktreeEntry = {
      path: "",
      head: null,
      branch: null,
      bare: false,
      detached: false,
      locked: false,
      lockedReason: null,
      prunable: false,
      prunableReason: null,
      primary: false,
    };
    for (const line of lines) {
      const space = line.indexOf(" ");
      const key = space === -1 ? line : line.slice(0, space);
      const value = space === -1 ? "" : line.slice(space + 1);
      switch (key) {
        case "worktree":
          entry.path = value;
          break;
        case "HEAD":
          entry.head = value;
          break;
        case "branch":
          entry.branch = shortBranch(value);
          break;
        case "bare":
          entry.bare = true;
          break;
        case "detached":
          entry.detached = true;
          break;
        case "locked":
          entry.locked = true;
          entry.lockedReason = value.length > 0 ? value : null;
          break;
        case "prunable":
          entry.prunable = true;
          entry.prunableReason = value.length > 0 ? value : null;
          break;
      }
    }
    entries.push(entry);
  }
  if (entries.length > 0) entries[0].primary = true;
  return entries;
}

// Absolute shared git directory for `dir`, or null when `dir` is not inside a
// git working tree — this also doubles as the "is this a git repo?" test.
const gitCommonDir = (dir: string): string | null => {
  const result = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: dir,
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  const out = result.stdout.trim();
  return out.length > 0 ? out : null;
};

// The primary plus linked worktrees for the repo containing `dir`. Called only
// after `gitCommonDir(dir)` confirmed a git repo, so the command succeeds.
const listWorktrees = (dir: string): WorktreeEntry[] => {
  const result = spawnSync("git", ["worktree", "list", "--porcelain"], {
    cwd: dir,
    encoding: "utf8",
  });
  return parseWorktreePorcelain(result.stdout);
};

// Immediate subdirectories of `dir`. A root that can't be read (missing or not
// a directory) contributes nothing rather than failing discovery.
const childDirs = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(dir, entry.name));
  } catch {
    return [];
  }
};

/**
 * Discover git repos reachable from `roots`, read-only. For each root: if the
 * root is itself a git repo it is the sole candidate, otherwise its immediate
 * children are scanned (no recursion). Each candidate's repo is grouped by its
 * shared git directory, so a repo reachable from several roots or via a linked
 * worktree is returned once, carrying its primary checkout and every linked
 * worktree. Never fetches or mutates.
 */
export function discoverRepos(roots: readonly string[]): DiscoveredRepo[] {
  const byCommonDir = new Map<string, DiscoveredRepo>();
  for (const root of roots) {
    const candidates = gitCommonDir(root) === null ? childDirs(root) : [root];
    for (const dir of candidates) {
      const commonDir = gitCommonDir(dir);
      if (commonDir === null) continue;
      if (byCommonDir.has(commonDir)) continue;
      const worktrees = listWorktrees(dir);
      byCommonDir.set(commonDir, {
        root: worktrees[0].path,
        gitCommonDir: commonDir,
        worktrees,
      });
    }
  }
  return [...byCommonDir.values()];
}
