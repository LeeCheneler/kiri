import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { type WorkflowSummary, fetchWorkflows, triggerRun } from "../api.ts";
import { BackLink } from "../components/ui/back-link.tsx";
import { LoadingState } from "../components/ui/loading-state.tsx";
import { WorkflowDetailView } from "../components/workflow-detail.tsx";
import { useLiveSync } from "../events/live.tsx";

type State =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "ready"; workflow: WorkflowSummary };

/**
 * Workflow detail route. Loads the workflow registry, finds the entry by
 * name, and renders one of: loading, not-found, error, or the editorial
 * detail view. Owns the trigger handler — it POSTs the run, awaits the
 * terminal status, then navigates to `/runs/:id` on success. Refetches
 * the registry when the matching workflow's YAML changes or is removed
 * so edits and deletions reflect without reload.
 */
export function WorkflowPage({ params }: { params: { name: string } }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [, navigate] = useLocation();
  const tokenRef = useRef(0);

  const refetch = useCallback(() => {
    const token = ++tokenRef.current;
    fetchWorkflows()
      .then((all) => {
        if (tokenRef.current !== token) return;
        const workflow = all.find((w) => w.name === params.name);
        if (!workflow) {
          setState({ status: "not-found" });
        } else {
          setState({ status: "ready", workflow });
        }
      })
      .catch((err: Error) => {
        if (tokenRef.current !== token) return;
        setState({ status: "error", message: err.message });
      });
  }, [params.name]);

  useEffect(() => {
    setState({ status: "loading" });
    refetch();
    return () => {
      tokenRef.current++;
    };
  }, [refetch]);

  useLiveSync({
    on: ["workflow.updated", "workflow.removed"],
    filter: (event) => event.name === params.name,
    refetch,
  });

  const handleTrigger = async (name: string, inputs?: Record<string, string>) => {
    const result = await triggerRun(name, inputs);
    navigate(`/runs/${result.runId}`);
    return result;
  };

  if (state.status === "loading") {
    return <LoadingState>Loading workflow…</LoadingState>;
  }
  if (state.status === "not-found") {
    return (
      <section>
        <BackLink href="/">all activity</BackLink>
        <h2 className="mt-6 font-display text-4xl text-ink leading-tight">Workflow not found</h2>
        <p className="mt-3 font-mono text-sm text-ink-muted">
          No workflow named <code className="text-ink">{params.name}</code>.
        </p>
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        Failed to load workflow: {state.message}
      </p>
    );
  }

  return <WorkflowDetailView workflow={state.workflow} onTrigger={handleTrigger} />;
}
