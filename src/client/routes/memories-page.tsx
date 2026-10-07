import { MemoriesList } from "../features/memories/memories-list.tsx";
import { PageShell } from "../features/page-shell/page-shell.tsx";
import { usePageTitle } from "../features/page-shell/use-page-title.ts";
import { SiteNav } from "../features/site-nav/site-nav.tsx";

/**
 * Memory index route. Composes the filterable memory list into the page
 * shell.
 */
export function MemoriesPage() {
  usePageTitle("Memories");
  return (
    <PageShell left={<SiteNav />} wide>
      <MemoriesList />
    </PageShell>
  );
}
