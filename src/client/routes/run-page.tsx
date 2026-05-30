import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  ApiError,
  type RunDetail,
  actionRecommendation,
  cancelRun,
  deleteRun,
  fetchRun,
  rerunRun,
} from "../api.ts";
import { RunDetailView } from "../components/run-detail.tsx";
import { BackLink } from "../components/ui/back-link.tsx";
import { LoadingState } from "../components/ui/loading-state.tsx";
import { useLiveSync } from "../events/live.tsx";
import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";
import { useWorkflows } from "../state/workflows.ts";

type State =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "ready"; detail: RunDetail };

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
 * Run detail content. Fetches the run by id and renders one of: loading,
 * not-found (404 from the API), generic error, or the editorial run
 * detail view. Owns only the run-fetch states; the populated case
 * delegates to `<RunDetailView>`. Refetches whenever a run/step event for
 * the matching id fires so step transitions surface live without reload.
 *
 * The run's *current* workflow definition — used to decide whether the
 * re-run path pre-fills the invoke modal — is read from the shared
 * workflows query, which stays live as definitions change. While it loads
 * (or if it fails) the list is empty and the run renders without the
 * modal-aware re-run.
 */
export function RunContent({ params }: { params: { id: string } }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const { data: workflows } = useWorkflows();
  const [, navigate] = useLocation();
  const tokenRef = useRef(0);
  // Spawned run ids whose lifecycle events should refetch this page.
  // Populated eagerly when the user actions a recommendation (so very
  // short spawned workflows can race their run.finished event ahead of
  // our refetch landing the actionedRunId into state) and refreshed from
  // state whenever the run reloads.
  const actionedRunIdsRef = useRef<Set<string>>(new Set());

  const refetch = useCallback(() => {
    const token = ++tokenRef.current;
    fetchRun(params.id)
      .then((detail) => {
        if (tokenRef.current !== token) return;
        for (const r of detail.run.recommendations ?? []) {
          if (r.actionedRunId) actionedRunIdsRef.current.add(r.actionedRunId);
        }
        setState({ status: "ready", detail });
      })
      .catch((err: Error) => {
        if (tokenRef.current !== token) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({ status: "not-found" });
        } else {
          setState({ status: "error", message: err.message });
        }
      });
  }, [params.id]);

  useEffect(() => {
    setState({ status: "loading" });
    actionedRunIdsRef.current = new Set();
    refetch();
    return () => {
      tokenRef.current++;
    };
  }, [refetch]);

  // Run lifecycle events: keep the page fresh for both this run and any
  // run a recommendation on this page has actioned (so the rec row's
  // status badge tracks the spawned run live).
  useLiveSync({
    on: ["run.updated", "run.step.updated", "run.finished"],
    filter: (event) => {
      const targetId = event.type === "run.step.updated" ? event.runId : event.id;
      if (targetId === params.id) return true;
      return actionedRunIdsRef.current.has(targetId);
    },
    refetch,
  });

  // Server-side rec actioning emits this so the row flips to its
  // status-badged link without waiting for the spawned run's first
  // run.updated event.
  useLiveSync({
    on: ["recommendation.actioned"],
    filter: (event) => event.runId === params.id,
    refetch,
  });

  if (state.status === "loading") {
    return <LoadingState>Loading run…</LoadingState>;
  }
  if (state.status === "not-found") {
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
  if (state.status === "error") {
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        Failed to load run: {state.message}
      </p>
    );
  }

  const handleDelete = async () => {
    if (!window.confirm("Delete this run? This cannot be undone.")) return;
    try {
      await deleteRun(params.id);
    } catch (err) {
      // Another tab (or stale data) already removed it — the user's
      // intent is satisfied either way; fall through to navigate home.
      if (!(err instanceof ApiError) || err.status !== 404) throw err;
    }
    navigate("/");
  };

  const handleRerun = async (inputs?: Record<string, string>) => {
    // The modal is the confirmation gesture when inputs are involved —
    // the user has filled the form and pressed Run. The bare path keeps
    // the explicit window.confirm so an accidental click doesn't wipe a
    // prior attempt without warning.
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
    const result = await actionRecommendation(params.id, recommendationId, inputs);
    // Register the spawned run id synchronously so its lifecycle events
    // (which can fire before the refetch below lands) pass the filter.
    actionedRunIdsRef.current.add(result.runId);
    refetch();
  };

  const workflowList = workflows ?? [];
  const workflowInputs = workflowList.find((w) => w.name === state.detail.run.workflowName)?.inputs;

  return (
    <RunDetailView
      detail={state.detail}
      onCancel={() => cancelRun(params.id)}
      onDelete={handleDelete}
      onRerun={handleRerun}
      workflowInputs={workflowInputs}
      workflows={workflowList}
      onActionRecommendation={handleActionRecommendation}
    />
  );
}
