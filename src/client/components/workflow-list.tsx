import { useState } from "react";
import { type WorkflowSummary, triggerRun } from "../api.ts";

interface WorkflowListProps {
  workflows: WorkflowSummary[];
  onRunComplete: () => void;
}

/**
 * Workflow registry view. One row per workflow with a Run button that
 * triggers a manual run and notifies the parent so the feed can refetch.
 */
export function WorkflowList({ workflows, onRunComplete }: WorkflowListProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onRun = async (name: string) => {
    setBusy(name);
    setError(null);
    try {
      await triggerRun(name);
      onRunComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  if (workflows.length === 0) {
    return (
      <section>
        <h2>Workflows</h2>
        <p>
          No workflows defined. Add a TS file to <code>workflows/</code>.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2>Workflows</h2>
      {error && <p className="error">Error: {error}</p>}
      <ul className="workflow-list">
        {workflows.map((wf) => (
          <li key={wf.name}>
            <button type="button" disabled={busy !== null} onClick={() => onRun(wf.name)}>
              {busy === wf.name ? "Running…" : "Run"}
            </button>
            <span className="workflow-name">{wf.name}</span>
            <span className="workflow-meta">
              {wf.nodes.length} node{wf.nodes.length === 1 ? "" : "s"}
              {wf.gating ? ` · ${wf.gating}` : ""}
              {wf.schedule ? ` · ${wf.schedule}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
