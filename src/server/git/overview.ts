import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { SCAN_CONCURRENCY, mapConcurrent } from "./concurrency.ts";
import { withConflicts } from "./conflicts.ts";
import { discoverRepos } from "./discovery.ts";
import { defaultBranch } from "./operations.ts";
import { type WorktreeStatus, worktreeStatus } from "./status.ts";

/** A discovered repo with the live status of its primary checkout and every linked worktree. */
export interface RepoOverview {
  /** Directory name of the primary checkout — also the `repos:` config key. */
  name: string;
  /** Absolute path of the primary checkout. */
  root: string;
  /** Absolute shared git directory — the repo's stable identity. */
  gitCommonDir: string;
  /**
   * The repo's default branch, or null when it has no discoverable one. Also the
   * base a brand-new branch is cut from when a create names none.
   */
  defaultBranch: string | null;
  /**
   * When the repo was last fetched, as an ISO timestamp, or null when it never
   * has been. Read from git's own record rather than tracked by kiri, so it
   * survives a restart and counts a fetch run in a terminal.
   */
  lastFetchedAt: string | null;
  /** Primary checkout first, then linked worktrees ordered by path. */
  worktrees: WorktreeStatus[];
}

/** The whole git surface: the roots that were scanned and the repos found under them. */
export interface GitOverview {
  /** Absolute roots scanned, in configured order. Empty when `git:` declares none. */
  roots: string[];
  /** Repos found, ordered by name. */
  repos: RepoOverview[];
}

const byPath = (a: WorktreeStatus, b: WorktreeStatus): number => a.path.localeCompare(b.path);

// When the repo last fetched, from the file git rewrites on every fetch. One
// stat rather than a git spawn, and absent until the first fetch has happened —
// which is a fact worth reporting, not an error.
const lastFetchedAt = async (gitCommonDir: string): Promise<string | null> => {
  try {
    return (await stat(join(gitCommonDir, "FETCH_HEAD"))).mtime.toISOString();
  } catch {
    return null;
  }
};

/**
 * Build the grouped repo model for `roots`: discover the repos reachable
 * from them and compute each worktree's live status. Ordered deterministically —
 * repos by name, worktrees with the primary first — so the rendered list is
 * stable across refreshes. Each repo also carries its default branch — the base
 * a brand-new branch is cut from — and when it was last fetched, stat'd from
 * git's own `FETCH_HEAD` rather than tracked by kiri. Read-only; runs git status
 * commands but never fetches or mutates.
 *
 * Each linked worktree is also merged into its repo's remote default branch in
 * the object store, so a branch that has stopped merging cleanly is carried by
 * the scan rather than discovered on a rebase. That is a genuine three-way merge
 * and the most expensive thing here, which is why it is confined to the linked
 * worktrees and runs in its own bounded pass at the end.
 */
export async function gitOverview(roots: readonly string[]): Promise<GitOverview> {
  const discovered = await discoverRepos(roots);

  // Every worktree in the workspace is one flat unit of work, so a single repo
  // with many worktrees parallelises as well as many single-worktree repos.
  const entries = discovered.flatMap((repo) => repo.worktrees);
  const statuses = await mapConcurrent(entries, SCAN_CONCURRENCY, worktreeStatus);
  const branches = await mapConcurrent(discovered, SCAN_CONCURRENCY, (repo) =>
    defaultBranch(repo.root),
  );
  const fetched = await mapConcurrent(discovered, SCAN_CONCURRENCY, (repo) =>
    lastFetchedAt(repo.gitCommonDir),
  );

  let offset = 0;
  const repos = discovered.map((repo, index) => {
    const own = statuses.slice(offset, offset + repo.worktrees.length);
    offset += repo.worktrees.length;
    return {
      name: basename(repo.root),
      root: repo.root,
      gitCommonDir: repo.gitCommonDir,
      defaultBranch: branches[index],
      lastFetchedAt: fetched[index],
      worktrees: [...own.filter((w) => w.primary), ...own.filter((w) => !w.primary).sort(byPath)],
    };
  });
  repos.sort((a, b) => a.name.localeCompare(b.name) || a.root.localeCompare(b.root));
  return { roots: [...roots], repos: await withConflicts(repos) };
}
