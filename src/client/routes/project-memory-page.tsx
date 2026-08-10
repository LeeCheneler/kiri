import { ProjectMemoryDetail } from "../features/memories/project-memory-detail.tsx";
import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";

/**
 * Project memory route. Composes one project-scoped memory's curation view —
 * read, edit, delete — into the page shell.
 */
export function ProjectMemoryPage({ params }: { params: { id: string; name: string } }) {
  return (
    <PageShell left={<SiteNav />}>
      <ProjectMemoryDetail projectId={params.id} name={params.name} />
    </PageShell>
  );
}
