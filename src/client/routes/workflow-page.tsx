import { LoadingState } from "../design-system/content/loading-state.tsx";
import { Breadcrumb } from "../design-system/navigation/breadcrumb.tsx";
import { PageShell } from "../features/page-shell/page-shell.tsx";
import { RunWorkflow } from "../features/run-workflow/run-workflow.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";
import { WorkflowDetails } from "../features/workflow-details/workflow-details.tsx";
import { WorkflowStats } from "../features/workflow-stats/workflow-stats.tsx";
import { useWorkflows } from "../state/workflows.ts";

const decodeName = (raw: string): string => {
  try {
    return decodeURIComponent(raw);
  } catch {
    // Malformed escape sequence: fall back to the raw param so the route
    // still resolves (typically to not-found) rather than crashing.
    return raw;
  }
};

/**
 * Workflow detail route. Composes the workflow detail content into the
 * page shell.
 */
export function WorkflowPage({ params }: { params: { name: string } }) {
  return (
    <PageShell left={<SiteNav />}>
      <WorkflowContent params={params} />
    </PageShell>
  );
}

/**
 * Workflow detail content. Reads the registry from the shared workflows
 * query and finds the entry by name, rendering one of: loading,
 * not-found, error, or the detail view. The registry stays live through
 * the query (invalidated app-wide as definitions change), so edits and
 * deletions reflect without reload.
 */
export function WorkflowContent({ params }: { params: { name: string } }) {
  const workflows = useWorkflows();

  // wouter leaves `%2F` alone (it uses `decodeURI`, not `decodeURIComponent`),
  // so a name with `/` arrives still encoded. Decode here once to match the
  // raw name returned by the API.
  const workflowName = decodeName(params.name);

  if (workflows.isPending) {
    return <LoadingState>Loading workflow…</LoadingState>;
  }
  if (workflows.isError) {
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        Failed to load workflow: {workflows.error.message}
      </p>
    );
  }

  const workflow = workflows.data.find((w) => w.name === workflowName);
  if (!workflow) {
    return (
      <section>
        <Breadcrumb items={[{ label: "Activity", href: "/" }]} current="Not found" />
        <h2 className="mt-6 font-display text-4xl text-ink leading-tight">Workflow not found</h2>
        <p className="mt-3 font-mono text-sm text-ink-muted">
          No workflow named <code className="text-ink">{workflowName}</code>.
        </p>
      </section>
    );
  }

  const eyebrow = workflow.group ? `${workflow.group} · Workflow` : "Workflow";

  return (
    <article>
      <Breadcrumb items={[{ label: "Activity", href: "/" }]} current={workflow.name} />
      <header className="mt-6 border-rule border-b pb-8">
        <p className="font-mono text-xs text-accent uppercase tracking-widest">{eyebrow}</p>
        <h2 className="mt-2 font-display text-6xl text-ink italic leading-[0.95] tracking-tight">
          {workflow.name}
        </h2>
        {workflow.description && (
          <p className="mt-4 max-w-[56ch] font-display text-lg text-ink-muted italic leading-[1.45]">
            {workflow.description}
          </p>
        )}
        <div className="mt-6">
          <RunWorkflow workflow={workflow} />
        </div>
      </header>
      <div className="mt-8">
        <WorkflowStats workflowName={workflow.name} />
      </div>
      <div className="mt-10">
        <WorkflowDetails workflow={workflow} />
      </div>
    </article>
  );
}
