import { ApiError } from "../api.ts";
import { LoadingState } from "../design-system/content/loading-state.tsx";
import { Markdown } from "../design-system/content/markdown.tsx";
import { Breadcrumb } from "../design-system/navigation/breadcrumb.tsx";
import { PageShell } from "../features/page-shell/page-shell.tsx";
import { RunActions } from "../features/run-detail/run-actions.tsx";
import { RunAside } from "../features/run-detail/run-aside.tsx";
import { RunFailure } from "../features/run-detail/run-failure.tsx";
import { RunHeader } from "../features/run-detail/run-header.tsx";
import { RunPhases } from "../features/run-detail/run-phases.tsx";
import { RunRecommendations } from "../features/run-detail/run-recommendations.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";
import { useRun } from "../state/runs.ts";
import { useWorkflows } from "../state/workflows.ts";

/**
 * Run detail route. Composes the run detail content into the page shell.
 */
export function RunPage({ params }: { params: { id: string } }) {
  return (
    <PageShell left={<SiteNav />} right={<RunAside id={params.id} />}>
      <RunContent params={params} />
    </PageShell>
  );
}

/**
 * Run detail content. Reads the run from the shared query — kept current by
 * the app's run live-sync — and renders one of: loading, not-found (404),
 * generic error, or the run detail (header, then the workflow's summary once
 * it has produced one).
 *
 * `now` is injectable so tests render deterministic times and the header's
 * live timer doesn't tick; production omits it.
 */
export function RunContent({ params, now }: { params: { id: string }; now?: Date }) {
  const run = useRun(params.id);
  // The re-run path reads the workflow's *current* declared inputs from the
  // registry to decide whether to open the pre-filled invoke modal.
  const { data: workflows } = useWorkflows();

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

  const { run: detail, steps } = run.data;
  const workflowInputs = workflows?.find((w) => w.name === detail.workflowName)?.inputs;

  return (
    <article>
      <Breadcrumb
        items={[
          { label: "Activity", href: "/" },
          {
            label: detail.workflowName,
            href: `/workflows/${encodeURIComponent(detail.workflowName)}`,
          },
        ]}
        current={detail.id.slice(0, 8)}
      />
      <RunHeader
        run={detail}
        now={now}
        actions={<RunActions run={detail} workflowInputs={workflowInputs} />}
      />
      {detail.summary ? (
        <div className="mt-8">
          <Markdown content={detail.summary} />
        </div>
      ) : null}
      {detail.error ? <RunFailure error={detail.error} /> : null}
      <RunPhases run={detail} steps={steps} now={now} />
      <RunRecommendations
        runId={detail.id}
        recommendations={detail.recommendations}
        workflows={workflows ?? []}
      />
    </article>
  );
}
