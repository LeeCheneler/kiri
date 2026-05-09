import { useEffect, useState } from "react";
import { Link } from "wouter";
import { type RunListEntry, fetchRuns } from "./api.ts";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; runs: RunListEntry[] };

/**
 * Dashboard route. Lists the run feed with each entry linking to its
 * detail page. Visual treatment is intentionally minimal — this is the
 * routing scaffold; the activity-feed redesign replaces the entry shape.
 */
export function Dashboard() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchRuns()
      .then((runs) => {
        if (!cancelled) setState({ status: "ready", runs });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ status: "error", message: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") return <p>Loading runs…</p>;
  if (state.status === "error") return <p role="alert">Failed to load runs: {state.message}</p>;
  if (state.runs.length === 0) return <p>No runs yet.</p>;

  return (
    <ul>
      {state.runs.map((run) => (
        <li key={run.id}>
          <Link href={`/runs/${run.id}`}>
            {run.workflowName} — {run.status}
          </Link>
        </li>
      ))}
    </ul>
  );
}
