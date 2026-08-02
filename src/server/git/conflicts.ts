import { SCAN_CONCURRENCY, mapConcurrent } from "./concurrency.ts";
import { conflictingPaths } from "./merge-tree.ts";
import type { GitOverview, RepoOverview } from "./overview.ts";
import { runGit } from "./run.ts";

/** Whether one linked worktree's branch still merges into the default branch. */
export interface WorktreeConflicts {
  /** Absolute path of the worktree the answer is about. */
  path: string;
  /** Files the merge would conflict in. Empty when the branch merges cleanly. */
  files: string[];
}

/** What a repo's linked worktrees would do if merged into its default branch. */
export interface RepoConflicts {
  /** Directory name of the repo checked. */
  repo: string;
  /**
   * The ref every branch was merged into — `origin/<default>`. Null when the
   * repo has no discoverable default branch or origin has no copy of it, in
   * which case there is nothing to compare against and no answers come back.
   */
  base: string | null;
  /**
   * One entry per linked worktree that could be answered for, in the repo's own
   * order. A worktree that is the default branch, is detached, or whose merge
   * git could not compute is absent rather than reported as clean.
   */
  worktrees: WorktreeConflicts[];
}

// The remote default branch, or null when there is no such ref to merge into.
// Deliberately the remote one: the local default branch is often behind, and the
// question is whether the branch still merges into what everyone else has.
const remoteDefaultBranch = async (repo: RepoOverview): Promise<string | null> => {
  if (repo.defaultBranch === null) return null;
  const ref = `refs/remotes/origin/${repo.defaultBranch}`;
  return (await runGit(repo.root, "show-ref", "--verify", "--quiet", ref)).ok
    ? `origin/${repo.defaultBranch}`
    : null;
};

// Worktrees worth merging: the linked ones sitting on a branch of their own. The
// primary checkout is excluded — it is the repo, and it is where the default
// branch itself lives — as are a detached HEAD and the default branch checked
// out elsewhere, neither of which has a question to answer.
const mergeable = (repo: RepoOverview) =>
  repo.worktrees.filter(
    (worktree) =>
      !worktree.primary &&
      !worktree.detached &&
      worktree.branch !== null &&
      worktree.branch !== repo.defaultBranch,
  );

/**
 * Merge each of `repo`'s linked worktree branches into the remote default
 * branch and report where that would conflict. Nothing is written, checked out,
 * or fetched: each merge runs entirely in the object store, and the answer is
 * only as current as the repo's last update, since `origin/<default>` moves
 * only when a fetch moves it.
 *
 * Far heavier than the read path's status commands — a genuine three-way merge
 * per worktree — so it is computed for the one repo being asked about rather
 * than across the workspace scan. The merges run under the same bound the scan
 * uses.
 */
export async function repoConflicts(repo: RepoOverview): Promise<RepoConflicts> {
  const base = await remoteDefaultBranch(repo);
  if (base === null) return { repo: repo.name, base: null, worktrees: [] };

  const candidates = mergeable(repo);
  const results = await mapConcurrent(candidates, SCAN_CONCURRENCY, (worktree) =>
    conflictingPaths(worktree.path, base, "HEAD"),
  );
  const worktrees = candidates
    .map((worktree, index) => ({ path: worktree.path, files: results[index] }))
    .filter((entry): entry is WorktreeConflicts => entry.files !== null);
  return { repo: repo.name, base, worktrees };
}

// What an answer was computed against, so it can be discarded once either side
// of the merge has moved.
interface CacheEntry {
  head: string | null;
  fetchedAt: string | null;
  files: string[];
}

/**
 * Remembers what the conflict check last found, so the workspace listing can
 * show answers it never paid for.
 */
export interface ConflictCache {
  /** Keep `result` as the answer for `repo` as it stands right now. */
  record(repo: RepoOverview, result: RepoConflicts): void;
  /** Copy of `overview` with every worktree carrying its remembered answer. */
  attach<T extends GitOverview>(overview: T): T;
}

/**
 * Hold the conflict check's answers in memory, keyed by the repo they belong to.
 * The check itself runs only when a repo is asked about, so the workspace
 * listing would otherwise have nothing to say about a repo nobody had opened;
 * this is what lets it report an answer without running a merge of its own.
 *
 * An answer survives only while both sides of the merge it describes are where
 * they were — the worktree's HEAD, and the repo's last fetch, which is what
 * moves `origin/<default>`. Once either moves the answer is dropped rather than
 * shown stale, so the listing goes quiet until the repo is checked again. Both
 * facts are already in the overview, so validating costs nothing.
 *
 * Nothing is persisted: a restart forgets, and the first repo page opened after
 * one recomputes.
 */
export function createConflictCache(): ConflictCache {
  const byRepo = new Map<string, Map<string, CacheEntry>>();

  return {
    record(repo, result) {
      const heads = new Map(repo.worktrees.map((worktree) => [worktree.path, worktree.head]));
      byRepo.set(
        repo.gitCommonDir,
        new Map(
          result.worktrees.map((entry) => [
            entry.path,
            {
              head: heads.get(entry.path) ?? null,
              fetchedAt: repo.lastFetchedAt,
              files: entry.files,
            },
          ]),
        ),
      );
    },

    attach(overview) {
      return {
        ...overview,
        repos: overview.repos.map((repo) => {
          const known = byRepo.get(repo.gitCommonDir);
          if (known === undefined) return repo;
          return {
            ...repo,
            worktrees: repo.worktrees.map((worktree) => {
              const entry = known.get(worktree.path);
              if (
                entry === undefined ||
                entry.head !== worktree.head ||
                entry.fetchedAt !== repo.lastFetchedAt
              ) {
                return worktree;
              }
              return { ...worktree, conflicts: entry.files };
            }),
          };
        }),
      };
    },
  };
}
