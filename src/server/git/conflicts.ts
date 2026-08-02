import { SCAN_CONCURRENCY, mapConcurrent } from "./concurrency.ts";
import { conflictingPaths } from "./merge-tree.ts";
import type { RepoOverview } from "./overview.ts";
import { runGit } from "./run.ts";
import type { WorktreeStatus } from "./status.ts";

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
const mergeable = (repo: RepoOverview): WorktreeStatus[] =>
  repo.worktrees.filter(
    (worktree) =>
      !worktree.primary &&
      !worktree.detached &&
      worktree.branch !== null &&
      worktree.branch !== repo.defaultBranch,
  );

/**
 * Merge every linked worktree branch in `repos` into its repo's remote default
 * branch, and carry where that would conflict on the worktree it is about.
 * Nothing is written, checked out, or fetched: each merge runs entirely in the
 * object store, and the answer is only as current as the repo's last fetch,
 * since `origin/<default>` moves only when one moves it.
 *
 * Two bounded passes — a ref check per repo, then a merge per mergeable
 * worktree — each flattened across the whole workspace, so one repo with many
 * worktrees parallelises as well as many repos with one.
 *
 * A worktree that is the default branch, is detached, or whose merge git could
 * not compute is left unmarked rather than reported as clean: an absent answer
 * means no answer, never an all-clear.
 */
export async function withConflicts(repos: readonly RepoOverview[]): Promise<RepoOverview[]> {
  // Which worktrees have a question at all is answered from the scan's own data,
  // before any git runs. A workspace is mostly repos with no linked worktree —
  // resolving a base ref for those would be a git spawn per repo to merge
  // nothing, which is the whole cost on a wide, quiet workspace.
  const asking = repos.filter((repo) => mergeable(repo).length > 0);
  const bases = await mapConcurrent(asking, SCAN_CONCURRENCY, remoteDefaultBranch);

  const targets = asking.flatMap((repo, index) => {
    const base = bases[index];
    return base === null ? [] : mergeable(repo).map((worktree) => ({ path: worktree.path, base }));
  });
  const merged = await mapConcurrent(targets, SCAN_CONCURRENCY, (target) =>
    conflictingPaths(target.path, target.base, "HEAD"),
  );

  const answers = new Map<string, string[]>();
  targets.forEach((target, index) => {
    const files = merged[index];
    if (files !== null) answers.set(target.path, files);
  });
  if (answers.size === 0) return [...repos];

  return repos.map((repo) => ({
    ...repo,
    worktrees: repo.worktrees.map((worktree) => {
      const files = answers.get(worktree.path);
      return files === undefined ? worktree : { ...worktree, conflicts: files };
    }),
  }));
}
