import { useEffect, useState } from "react";
import { type RunListEntry, fetchRuns } from "../api.ts";
import { ActivityFeed } from "../components/activity-feed.tsx";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; runs: RunListEntry[] };

/**
 * Dashboard route. Renders an editorial section header above the
 * activity feed; owns only the loading and error states and delegates
 * the populated/empty rendering to `<ActivityFeed>`.
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

  return (
    <section>
      <header className="mb-6 flex items-baseline border-b border-rule pb-3">
        <h2 className="text-xs tracking-widest text-ink-muted uppercase">Activity</h2>
      </header>
      {state.status === "loading" ? (
        <p className="text-ink-muted italic">Loading runs…</p>
      ) : state.status === "error" ? (
        <p role="alert" className="text-status-failed">
          Failed to load runs: {state.message}
        </p>
      ) : (
        <ActivityFeed runs={state.runs} />
      )}
    </section>
  );
}
