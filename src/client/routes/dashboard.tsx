import { useCallback, useEffect, useRef, useState } from "react";
import { type RunListEntry, fetchRuns } from "../api.ts";
import { ActivityFeed } from "../components/activity-feed.tsx";
import { useLiveSync } from "../events/live.tsx";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; runs: RunListEntry[] };

/**
 * Dashboard route. Renders an editorial section header above the
 * activity feed; owns only the loading and error states and delegates
 * the populated/empty rendering to `<ActivityFeed>`. Refetches whenever
 * a run lifecycle event fires so the feed stays live without reload.
 */
export function Dashboard() {
  const [state, setState] = useState<State>({ status: "loading" });
  const tokenRef = useRef(0);

  const refetch = useCallback(() => {
    const token = ++tokenRef.current;
    fetchRuns()
      .then((runs) => {
        if (tokenRef.current !== token) return;
        setState({ status: "ready", runs });
      })
      .catch((err: Error) => {
        if (tokenRef.current !== token) return;
        setState({ status: "error", message: err.message });
      });
  }, []);

  useEffect(() => {
    refetch();
    return () => {
      // Bump the token so any in-flight fetch's resolution is ignored.
      tokenRef.current++;
    };
  }, [refetch]);

  useLiveSync({ on: ["run.started", "run.updated", "run.finished"], refetch });

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
