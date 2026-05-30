import { BackLink } from "../components/ui/back-link.tsx";
import { LoadingState } from "../components/ui/loading-state.tsx";
import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";
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
        <BackLink href="/">all activity</BackLink>
        <h2 className="mt-6 font-display text-4xl text-ink leading-tight">Workflow not found</h2>
        <p className="mt-3 font-mono text-sm text-ink-muted">
          No workflow named <code className="text-ink">{workflowName}</code>.
        </p>
      </section>
    );
  }

  return (
    <article>
      <h2 className="font-display text-6xl text-ink italic leading-[0.95] tracking-tight">
        {workflow.name}
      </h2>
    </article>
  );
}
