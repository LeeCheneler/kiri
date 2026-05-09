import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ApiError, type RunDetail, fetchRun } from "../api.ts";

type State =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "ready"; detail: RunDetail };

/**
 * Run detail route. Fetches the run by id and renders one of: loading,
 * not-found (404 from the API), generic error, or the loaded run summary.
 * Per-step expandable detail lands in a follow-up ticket — this is the
 * routing scaffold.
 */
export function RunPage({ params }: { params: { id: string } }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchRun(params.id)
      .then((detail) => {
        if (!cancelled) setState({ status: "ready", detail });
      })
      .catch((err: Error) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({ status: "not-found" });
        } else {
          setState({ status: "error", message: err.message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (state.status === "loading") return <p>Loading run…</p>;
  if (state.status === "not-found") {
    return (
      <section>
        <h2>Run not found</h2>
        <p>
          No run with id <code>{params.id}</code>.
        </p>
        <Link href="/">Back to dashboard</Link>
      </section>
    );
  }
  if (state.status === "error") {
    return <p role="alert">Failed to load run: {state.message}</p>;
  }

  const { run } = state.detail;
  return (
    <section>
      <h2>{run.workflowName}</h2>
      <p>Status: {run.status}</p>
      <Link href="/">Back to dashboard</Link>
    </section>
  );
}
