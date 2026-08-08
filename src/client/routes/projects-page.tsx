import { PageShell } from "../features/page-shell/page-shell.tsx";
import { ProjectsList } from "../features/projects/projects-list.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";

/**
 * Project index route. Composes the project list and create form into the
 * page shell.
 */
export function ProjectsPage() {
  return (
    <PageShell left={<SiteNav />} wide>
      <ProjectsList />
    </PageShell>
  );
}
