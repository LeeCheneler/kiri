import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ApiError,
  type RunDetail,
  type WorkflowInputSummary,
  cancelRun,
  deleteRun,
  fetchRun,
  fetchWorkflows,
  rerunRun,
} from "../api.ts";
import { RunDetailView } from "../components/run-detail.tsx";
import { LoadingState } from "../components/ui/loading-state.tsx";
import { useLiveSync } from "../events/live.tsx";

type State =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "ready"; detail: RunDetail };

/**
 * Run detail route. Fetches the run by id and renders one of: loading,
 * not-found (404 from the API), generic error, or the editorial run
 * detail view. Owns only the fetch states; the populated case delegates
 * to `<RunDetailView>`. Refetches whenever a run/step event for the
 * matching id fires so step transitions surface live without reload.
 *
 * Also resolves the run's *current* workflow definition from the
 * registry so the re-run path knows whether to pre-fill the invoke
 * modal. Both fetches are issued in parallel and joined before the
 * "ready" state flips, so the modal-armed signal arrives with the
 * rest of the page. A workflow registry fetch failure is swallowed —
 * the run renders without the modal-aware re-run.
 */
export function RunPage({ params }: { params: { id: string } }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [workflowInputs, setWorkflowInputs] = useState<WorkflowInputSummary[] | undefined>(
    undefined,
  );
  const [, navigate] = useLocation();
  const tokenRef = useRef(0);

  const refetch = useCallback(() => {
    const token = ++tokenRef.current;
    Promise.allSettled([fetchRun(params.id), fetchWorkflows()]).then(([runResult, wfResult]) => {
      if (tokenRef.current !== token) return;
      if (runResult.status === "rejected") {
        const err = runResult.reason as Error;
        if (err instanceof ApiError && err.status === 404) {
          setState({ status: "not-found" });
        } else {
          setState({ status: "error", message: err.message });
        }
        return;
      }
      const detail = runResult.value;
      const workflows = wfResult.status === "fulfilled" ? wfResult.value : [];
      const wf = workflows.find((w) => w.name === detail.run.workflowName);
      setWorkflowInputs(wf?.inputs);
      setState({ status: "ready", detail });
    });
  }, [params.id]);

  useEffect(() => {
    setState({ status: "loading" });
    setWorkflowInputs(undefined);
    refetch();
    return () => {
      tokenRef.current++;
    };
  }, [refetch]);

  useLiveSync({
    on: ["run.updated", "run.step.updated", "run.finished"],
    filter: (event) =>
      event.type === "run.step.updated" ? event.runId === params.id : event.id === params.id,
    refetch,
  });

  useLiveSync({
    on: ["workflow.updated", "workflow.removed"],
    filter: (event) => state.status === "ready" && event.name === state.detail.run.workflowName,
    refetch,
  });

  if (state.status === "loading") {
    return <LoadingState>Loading run…</LoadingState>;
  }
  if (state.status === "not-found") {
    return (
      <section>
        <Link
          href="/"
          className="font-mono text-xs tracking-widest text-ink-muted uppercase no-underline transition-colors duration-150 hover:text-accent focus-visible:text-accent focus-visible:outline-none"
        >
          ← all activity
        </Link>
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

  return (
    <RunDetailView
      detail={state.detail}
      onCancel={() => cancelRun(params.id)}
      onDelete={handleDelete}
      onRerun={handleRerun}
      workflowInputs={workflowInputs}
    />
  );
}
