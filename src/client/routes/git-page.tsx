import { WorktreesOverview } from "../features/git/worktrees-overview.tsx";
import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";

/**
 * The Git route: every repo discovered under the configured roots with its
 * primary checkout and linked worktrees, composed into the page shell.
 */
export function GitPage() {
  return (
    <PageShell left={<SiteNav />} wide>
      <WorktreesOverview />
    </PageShell>
  );
}
