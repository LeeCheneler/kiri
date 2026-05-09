import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ApiError, type RunDetail, fetchRun } from "../api.ts";
import { RunDetailView } from "../components/run-detail.tsx";
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
 */
export function RunPage({ params }: { params: { id: string } }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const tokenRef = useRef(0);

  const refetch = useCallback(() => {
    const token = ++tokenRef.current;
    fetchRun(params.id)
      .then((detail) => {
        if (tokenRef.current !== token) return;
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

  if (state.status === "loading") {
    return <p className="font-display text-base text-ink-muted italic">Loading run…</p>;
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

  return <RunDetailView detail={state.detail} />;
}
