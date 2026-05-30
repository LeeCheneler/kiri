import { useLocation } from "wouter";
import { ApiError, actionRecommendation, cancelRun, deleteRun, rerunRun } from "../api.ts";
import { RunDetailView } from "../components/run-detail.tsx";
import { BackLink } from "../components/ui/back-link.tsx";
import { LoadingState } from "../components/ui/loading-state.tsx";
import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";
import { useRun } from "../state/runs.ts";
import { useWorkflows } from "../state/workflows.ts";

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
 * Run detail content. Reads the run from the shared query — kept current
 * by the app's run live-sync, including the spawned-run status the server
 * reflects onto this run's recommendations — and renders one of: loading,
 * not-found (404), generic error, or the editorial run detail view.
 *
 * The re-run path reads the run's *current* workflow definition from the
 * workflows query to decide whether to pre-fill the invoke modal; while
 * that loads (or if it fails) the list is empty and the run renders
 * without the modal-aware re-run.
 */
export function RunContent({ params }: { params: { id: string } }) {
  const run = useRun(params.id);
  const { data: workflows } = useWorkflows();
  const [, navigate] = useLocation();

  if (run.isPending) {
    return <LoadingState>Loading run…</LoadingState>;
  }
  if (run.isError) {
    if (run.error instanceof ApiError && run.error.status === 404) {
      return (
        <section>
          <BackLink href="/">all activity</BackLink>
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

  const handleDelete = async () => {
    if (!window.confirm("Delete this run? This cannot be undone.")) return;
    try {
      await deleteRun(params.id);
    } catch (err) {
      // Another tab (or stale data) already removed it — the user's intent
      // is satisfied either way; fall through to navigate home.
      if (!(err instanceof ApiError) || err.status !== 404) throw err;
    }
    navigate("/");
  };

  const handleRerun = async (inputs?: Record<string, string>) => {
    // The modal is the confirmation gesture when inputs are involved — the
    // user has filled the form and pressed Run. The bare path keeps the
    // explicit window.confirm so an accidental click doesn't wipe a prior
    // attempt without warning.
    if (inputs === undefined) {
      if (!window.confirm("Run again? The previous attempt's steps and traces will be cleared."))
        return;
    }
    await rerunRun(params.id, inputs);
  };

  const handleActionRecommendation = async (
    recommendationId: string,
    inputs?: Record<string, string>,
  ) => {
    // The server emits recommendation.actioned on success, which
    // invalidates this run's query and refreshes the rec row — no manual
    // refetch needed.
    await actionRecommendation(params.id, recommendationId, inputs);
  };

  const workflowList = workflows ?? [];
  const workflowInputs = workflowList.find((w) => w.name === detail.run.workflowName)?.inputs;

  return (
    <RunDetailView
      detail={detail}
      onCancel={() => cancelRun(params.id)}
      onDelete={handleDelete}
      onRerun={handleRerun}
      workflowInputs={workflowInputs}
      workflows={workflowList}
      onActionRecommendation={handleActionRecommendation}
    />
  );
}
