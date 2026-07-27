import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";
import { WorktreesOverview } from "../features/worktrees/worktrees-overview.tsx";

/**
 * The Worktrees route: every repo discovered under the configured roots with
 * its primary checkout and linked worktrees, composed into the page shell.
 */
export function WorktreesPage() {
  return (
    <PageShell left={<SiteNav />} wide>
      <WorktreesOverview />
    </PageShell>
  );
}
