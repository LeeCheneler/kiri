import { ApiError } from "../api.ts";
import { LoadingState } from "../design-system/content/loading-state.tsx";
import { Breadcrumb } from "../design-system/navigation/breadcrumb.tsx";
import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";
import { useRun } from "../state/runs.ts";

/**
 * Run detail route. Composes the run detail content into the page shell.
 */
export function RunPage({ params }: { params: { id: string } }) {
  return (
    <PageShell left={<SiteNav />}>
      <RunContent params={params} />
    </PageShell>
  );
}

/**
 * Run detail content. Reads the run from the shared query — kept current by
 * the app's run live-sync — and renders one of: loading, not-found (404),
 * generic error, or the run's breadcrumb trail (Activity → workflow → run).
 */
export function RunContent({ params }: { params: { id: string } }) {
  const run = useRun(params.id);

  if (run.isPending) {
    return <LoadingState>Loading run…</LoadingState>;
  }
  if (run.isError) {
    if (run.error instanceof ApiError && run.error.status === 404) {
      return (
        <section>
          <Breadcrumb items={[{ label: "Activity", href: "/" }]} current="Not found" />
          <h2 className="mt-6 font-display text-4xl text-ink leading-tight">Run not found</h2>
          <p className="mt-3 font-mono text-sm text-ink-muted">
            No run with id <code className="text-ink">{params.id}</code>.
          </p>
        </section>
      );
    }
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        Failed to load run: {run.error.message}
      </p>
    );
  }

  const detail = run.data;

  return (
    <article>
      <Breadcrumb
        items={[
          { label: "Activity", href: "/" },
          {
            label: detail.run.workflowName,
            href: `/workflows/${encodeURIComponent(detail.run.workflowName)}`,
          },
        ]}
        current={detail.run.id.slice(0, 8)}
      />
    </article>
  );
}
