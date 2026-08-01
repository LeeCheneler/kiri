import { RepoList } from "../features/git/repo-list.tsx";
import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";

/**
 * The Git route: every repo discovered under the configured roots, each linking
 * through to its own page, composed into the page shell.
 */
export function GitPage() {
  return (
    <PageShell left={<SiteNav />} wide>
      <RepoList />
    </PageShell>
  );
}
