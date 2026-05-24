import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ApiError, type ArticleDetail, fetchArticle } from "../api.ts";
import { CopyButton } from "../components/copy-button.tsx";
import { Markdown } from "../components/markdown.tsx";
import { LoadingState } from "../components/ui/loading-state.tsx";
import { formatRelativeTime } from "../formatters/format-time.ts";

type State =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "ready"; article: ArticleDetail };

/**
 * Published-article route. Fetches a single article by `(runId, name)`
 * once on mount and renders the markdown body through the sandboxed
 * `<Markdown>` component. No live sync — once an article is
 * written its row is immutable.
 *
 * `now` is injectable so component tests render deterministic relative
 * timestamps; production callers omit it and pick up the system clock.
 */
export function ArticlePage({
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
    fetchArticle(params.id, params.name)
      .then((article) => {
        if (tokenRef.current !== token) return;
        setState({ status: "ready", article });
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
    return <LoadingState>Loading article…</LoadingState>;
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
        <h2 className="mt-6 font-display text-4xl text-ink leading-tight">Article not found</h2>
        <p className="mt-3 font-mono text-sm text-ink-muted">
          No article named <code className="text-ink">{params.name}</code> on run{" "}
          <code className="text-ink">{params.id}</code>.
        </p>
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        Failed to load article: {state.message}
      </p>
    );
  }

  const { article } = state;
  return (
    <article>
      <Link
        href={`/runs/${article.runId}`}
        className="font-mono text-xs tracking-widest text-ink-muted uppercase no-underline transition-colors duration-150 hover:text-accent focus-visible:text-accent focus-visible:outline-none"
      >
        ← back to run
      </Link>

      <header className="mt-6 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs tracking-widest text-ink-muted uppercase">
            {article.workflowName}
          </div>
          <h2 className="mt-2 font-display text-4xl text-ink leading-tight">{article.title}</h2>
          <dl className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-ink-muted">
            <div className="flex items-baseline">
              <dt className="sr-only">run</dt>
              <dd>
                <Link
                  href={`/runs/${article.runId}`}
                  className="font-mono text-ink-muted no-underline transition-colors hover:text-accent focus-visible:text-accent"
                >
                  run {article.runId.slice(0, 8)}
                </Link>
              </dd>
            </div>
            <span aria-hidden="true" className="text-rule">
              ·
            </span>
            <div className="flex items-baseline">
              <dt className="sr-only">created</dt>
              <dd>
                <time dateTime={article.createdAt} title={article.createdAt}>
                  {formatRelativeTime(article.createdAt, now)}
                </time>
              </dd>
            </div>
          </dl>
        </div>
        <CopyButton content={article.contentMd} />
      </header>

      <div className="mt-10">
        <Markdown content={article.contentMd} />
      </div>
    </article>
  );
}
