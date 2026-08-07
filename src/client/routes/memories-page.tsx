import { MemoriesList } from "../features/memories/memories-list.tsx";
import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";

/**
 * Memory index route. Composes the filterable memory list into the page
 * shell.
 */
export function MemoriesPage() {
  return (
    <PageShell left={<SiteNav />} wide>
      <MemoriesList />
    </PageShell>
  );
}
