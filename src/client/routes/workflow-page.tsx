import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { type WorkflowSummary, fetchWorkflows, triggerRun } from "../api.ts";
import { WorkflowDetailView } from "../components/workflow-detail.tsx";

type State =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "ready"; workflow: WorkflowSummary };

/**
 * Workflow detail route. Loads the workflow registry, finds the entry by
 * name, and renders one of: loading, not-found, error, or the editorial
 * detail view. Owns the trigger handler — it POSTs the run, awaits the
 * terminal status, then navigates to `/runs/:id` on success.
 */
export function WorkflowPage({ params }: { params: { name: string } }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [, navigate] = useLocation();

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchWorkflows()
      .then((all) => {
        if (cancelled) return;
        const workflow = all.find((w) => w.name === params.name);
        if (!workflow) {
          setState({ status: "not-found" });
        } else {
          setState({ status: "ready", workflow });
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ status: "error", message: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [params.name]);

  const handleTrigger = async (name: string) => {
    const result = await triggerRun(name);
    navigate(`/runs/${result.runId}`);
    return result;
  };

  if (state.status === "loading") {
    return <p className="font-display text-base text-ink-muted italic">Loading workflow…</p>;
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
