import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";
import { WorkflowCatalog } from "../features/workflow-catalog/workflow-catalog.tsx";

/**
 * Workflow catalogue route. Composes the searchable, grouped workflow
 * launcher into the page shell.
 */
export function WorkflowsPage() {
  return (
    <PageShell left={<SiteNav />} wide>
      <WorkflowCatalog />
    </PageShell>
  );
}
