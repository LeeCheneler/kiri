import type { RepoOverview, WorktreeStatus } from "../../api.ts";
import { InlineLink } from "../../design-system/content/inline-link.tsx";
import { changesHref, changesView } from "./worktree-state.ts";

/**
 * The way into a checkout's changes, or the reason there is nothing to open.
 *
 * Which view it lands on is decided from the scan the page already has — a dirty
 * checkout leads with its working tree, anything else with what its branch
 * introduces — so no diff is computed to work out where to point. A clean
 * checkout on the default branch has nothing either view could show, and says so
 * instead of offering a link to an empty page.
 */
export function ChangesLink({ repo, worktree }: { repo: RepoOverview; worktree: WorktreeStatus }) {
  const view = changesView(worktree, repo.defaultBranch);
  if (view === null) {
    return (
      <span className="font-mono text-ink-muted text-xs">
        Nothing to review — clean, and on the default branch.
      </span>
    );
  }
  return <InlineLink href={changesHref(repo.name, worktree.path, view)}>Review changes</InlineLink>;
}
