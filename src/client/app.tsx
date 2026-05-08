import { useCallback, useEffect, useState } from "react";
import { type RunListEntry, type WorkflowSummary, fetchRuns, fetchWorkflows } from "./api.ts";
import { RunFeed } from "./components/run-feed.tsx";
import { WorkflowList } from "./components/workflow-list.tsx";

/**
 * Single-page kiri SPA: workflow registry on top, run feed below.
 * After a manual run completes, both queries refetch so the feed and
 * any orphan flags stay in sync.
 */
export function App() {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [runs, setRuns] = useState<RunListEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [w, r] = await Promise.all([fetchWorkflows(), fetchRuns()]);
      setWorkflows(w);
      setRuns(r);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <main>
      <header>
        <h1>Kiri</h1>
        <button type="button" onClick={() => void reload()}>
          Refresh
        </button>
      </header>
      {error && <p className="error">Error: {error}</p>}
      <WorkflowList workflows={workflows} onRunComplete={reload} />
      <RunFeed runs={runs} />
    </main>
  );
}
