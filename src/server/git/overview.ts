import { basename } from "node:path";
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

/**
 * Build the grouped repo model for `roots`: discover the repos reachable
 * from them and compute each worktree's live status. Ordered deterministically —
 * repos by name, worktrees with the primary first — so the rendered list is
 * stable across refreshes. Each repo also carries its default branch, the base a
 * brand-new branch is cut from. Read-only; runs git status commands but never
 * fetches or mutates.
 */
export function gitOverview(roots: readonly string[]): GitOverview {
  const repos = discoverRepos(roots).map((repo) => {
    const statuses = repo.worktrees.map(worktreeStatus);
    return {
      name: basename(repo.root),
      root: repo.root,
      gitCommonDir: repo.gitCommonDir,
      defaultBranch: defaultBranch(repo.root),
      worktrees: [
        ...statuses.filter((w) => w.primary),
        ...statuses.filter((w) => !w.primary).sort(byPath),
      ],
    };
  });
  repos.sort((a, b) => a.name.localeCompare(b.name) || a.root.localeCompare(b.root));
  return { roots: [...roots], repos };
}
