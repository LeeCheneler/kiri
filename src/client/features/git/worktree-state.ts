import type { ChangesetView, WorktreeStatus } from "../../api.ts";
import type { TagTone } from "../../design-system/content/tag.tsx";

/**
 * Trailing directory name of an absolute path — what a worktree is known by in
 * conversation ("kiri-feat-search"), with the full path kept alongside it.
 */
export const dirName = (path: string): string => path.split("/").filter(Boolean).pop() ?? path;

/**
 * Where a checkout's changes are read: its repo, then its own directory name.
 * The primary checkout's directory is the repo's, so it addresses itself
 * without an id scheme of its own.
 */
export const changesHref = (repo: string, path: string, view: ChangesetView): string =>
  `/git/${encodeURIComponent(repo)}/changes/${encodeURIComponent(dirName(path))}?view=${view}`;

/**
 * Which view of a checkout is worth landing on, decided from the scan alone: a
 * dirty checkout leads with its working tree, anything else with what its branch
 * introduces. Null when the scan already proves both views are empty — a clean
 * checkout sitting on the default branch has nothing either could show — so a
 * link to it can be withheld rather than leading somewhere empty.
 */
export const changesView = (
  worktree: WorktreeStatus,
  defaultBranch: string | null,
): ChangesetView | null => {
  if (worktree.dirty) return "uncommitted";
  if (defaultBranch !== null && !worktree.detached && worktree.branch === defaultBranch)
    return null;
  return "branch";
};

/** What a checkout is sitting on, phrased for a reader rather than left blank. */
export const branchLabel = (worktree: WorktreeStatus): string =>
  worktree.detached ? "detached" : (worktree.branch ?? "no branch");

/**
 * A worktree's state as a rail of tags, ordered so the working tree leads and
 * the rarer flags trail. Working-tree state is always stated — clean is a fact
 * worth reading, not an absence. Tracking is reported only when it has something
 * to say: a branch level with its upstream, or with no upstream at all, stays
 * silent rather than showing a row of zeroes.
 */
export const stateTags = (worktree: WorktreeStatus): { label: string; tone: TagTone }[] => {
  const tags: { label: string; tone: TagTone }[] = [
    worktree.dirty ? { label: "dirty", tone: "caution" } : { label: "clean", tone: "positive" },
  ];
  if (worktree.upstreamGone) tags.push({ label: "upstream gone", tone: "negative" });
  if (worktree.ahead > 0) tags.push({ label: `ahead ${worktree.ahead}`, tone: "caution" });
  if (worktree.behind > 0) tags.push({ label: `behind ${worktree.behind}`, tone: "caution" });
  if (worktree.locked) tags.push({ label: "locked", tone: "neutral" });
  if (worktree.prunable) tags.push({ label: "prunable", tone: "negative" });
  return tags;
};
