import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ApiError, type RunArtefactDetail, fetchArtefact } from "../api.ts";
import { ArtefactMarkdown } from "../components/artefact-markdown.tsx";
import { formatRelativeTime } from "../formatters/format-time.ts";

type State =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "ready"; artefact: RunArtefactDetail };

/**
 * Published-artefact route. Fetches a single artefact by `(runId, name)`
 * once on mount and renders the markdown body through the sandboxed
 * `<ArtefactMarkdown>` component. No live sync — once an artefact is
 * written its row is immutable.
 *
 * `now` is injectable so component tests render deterministic relative
 * timestamps; production callers omit it and pick up the system clock.
 */
export function ArtefactPage({
  params,
  now,
}: {
  params: { id: string; name: string };
  now?: Date;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const tokenRef = useRef(0);

  useEffect(() => {
    const token = ++tokenRef.current;
    setState({ status: "loading" });
    fetchArtefact(params.id, params.name)
      .then((artefact) => {
        if (tokenRef.current !== token) return;
        setState({ status: "ready", artefact });
      })
      .catch((err: Error) => {
        if (tokenRef.current !== token) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({ status: "not-found" });
        } else {
          setState({ status: "error", message: err.message });
        }
      });
    return () => {
      tokenRef.current++;
    };
  }, [params.id, params.name]);

  if (state.status === "loading") {
    return <p className="font-display text-base text-ink-muted italic">Loading artefact…</p>;
  }
  if (state.status === "not-found") {
    return (
      <section>
        <Link
          href={`/runs/${params.id}`}
          className="font-mono text-xs tracking-widest text-ink-muted uppercase no-underline transition-colors duration-150 hover:text-accent focus-visible:text-accent focus-visible:outline-none"
        >
          ← back to run
        </Link>
        <h2 className="mt-6 font-display text-4xl text-ink leading-tight">Artefact not found</h2>
        <p className="mt-3 font-mono text-sm text-ink-muted">
          No artefact named <code className="text-ink">{params.name}</code> on run{" "}
          <code className="text-ink">{params.id}</code>.
        </p>
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        Failed to load artefact: {state.message}
      </p>
    );
  }

  const { artefact } = state;
  return (
    <article>
      <Link
        href={`/runs/${artefact.runId}`}
        className="font-mono text-xs tracking-widest text-ink-muted uppercase no-underline transition-colors duration-150 hover:text-accent focus-visible:text-accent focus-visible:outline-none"
      >
        ← back to run
      </Link>

      <header className="mt-6">
        <div className="text-xs tracking-widest text-ink-muted uppercase">
          {artefact.workflowName}
        </div>
        <h2 className="mt-2 font-display text-4xl text-ink leading-tight">{artefact.title}</h2>
        <dl className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-ink-muted">
          <div className="flex items-baseline">
            <dt className="sr-only">run</dt>
            <dd>
              <Link
                href={`/runs/${artefact.runId}`}
                className="font-mono text-ink-muted no-underline transition-colors hover:text-accent focus-visible:text-accent"
              >
                run {artefact.runId.slice(0, 8)}
              </Link>
            </dd>
          </div>
          <span aria-hidden="true" className="text-rule">
            ·
          </span>
          <div className="flex items-baseline">
            <dt className="sr-only">created</dt>
            <dd>
              <time dateTime={artefact.createdAt} title={artefact.createdAt}>
                {formatRelativeTime(artefact.createdAt, now)}
              </time>
            </dd>
          </div>
        </dl>
      </header>

      <div className="mt-10">
        <ArtefactMarkdown content={artefact.contentMd} />
      </div>
    </article>
  );
}
