import type { RepoOverview, WorktreeStatus } from "../../api.ts";
import { InlineLink } from "../../design-system/content/inline-link.tsx";
import { changesHref, changesView } from "./worktree-state.ts";

/**
 * The way into a checkout's changes, when there are any to read.
 *
 * Which view it lands on is decided from the scan the page already has — a dirty
 * checkout leads with its working tree, anything else with what its branch
 * introduces — so no diff is computed to work out where to point. A clean
 * checkout on the default branch has nothing either view could show, and renders
 * nothing rather than linking to an empty page or explaining itself: the card
 * already says the checkout is clean and which branch it is on.
 */
export function ChangesLink({ repo, worktree }: { repo: RepoOverview; worktree: WorktreeStatus }) {
  const view = changesView(worktree, repo.defaultBranch);
  if (view === null) return null;
  return <InlineLink href={changesHref(repo.name, worktree.path, view)}>Review changes</InlineLink>;
}
