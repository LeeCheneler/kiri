import { PageShell } from "../features/page-shell/page-shell.tsx";
import { ProjectDetail } from "../features/projects/project-detail.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";

/**
 * Project detail route. Composes one project's page — its article and
 * session indexes, rename, and delete — into the page shell.
 */
export function ProjectPage({ params }: { params: { id: string } }) {
  return (
    <PageShell left={<SiteNav />} wide>
      <ProjectDetail id={params.id} />
    </PageShell>
  );
}
