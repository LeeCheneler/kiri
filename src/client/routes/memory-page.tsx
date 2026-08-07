import { MemoryDetail } from "../features/memories/memory-detail.tsx";
import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";

/**
 * Memory detail route. Composes one memory's curation view — read, edit,
 * delete — into the page shell.
 */
export function MemoryPage({ params }: { params: { name: string } }) {
  return (
    <PageShell left={<SiteNav />}>
      <MemoryDetail name={params.name} />
    </PageShell>
  );
}
