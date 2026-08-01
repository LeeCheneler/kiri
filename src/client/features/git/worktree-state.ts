import type { WorktreeStatus } from "../../api.ts";
import type { TagTone } from "../../design-system/content/tag.tsx";

/**
 * Trailing directory name of an absolute path — what a worktree is known by in
 * conversation ("kiri-feat-search"), with the full path kept alongside it.
 */
export const dirName = (path: string): string => path.split("/").filter(Boolean).pop() ?? path;

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
