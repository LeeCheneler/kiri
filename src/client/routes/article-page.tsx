import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ApiError, type ArticleDetail, fetchArticle } from "../api.ts";
import { CopyButton } from "../components/copy-button.tsx";
import { Markdown } from "../components/markdown.tsx";
import { BackLink } from "../components/ui/back-link.tsx";
import { LoadingState } from "../components/ui/loading-state.tsx";
import { formatDuration, formatRelativeTime } from "../formatters/format-time.ts";

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
        <BackLink href={`/runs/${params.id}`}>back to run</BackLink>
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
      <BackLink href={`/runs/${article.runId}`}>back to run</BackLink>

      <header className="mt-6">
        <h2 className="font-display text-[76px] text-ink italic leading-[0.95] tracking-tight">
          {article.title}
        </h2>

        <div className="mt-7 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-rule border-b pb-3.5 font-mono text-xs text-ink-muted">
          <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
            <span>From the run on</span>
            <Link
              href={`/workflows/${article.workflowName}`}
              className="font-medium text-ink no-underline transition-colors hover:text-accent focus-visible:text-accent"
            >
              {article.workflowName}
            </Link>
            <span aria-hidden="true" className="text-rule">
              ·
            </span>
            <time dateTime={article.createdAt} title={article.createdAt}>
              {formatRelativeTime(article.createdAt, now)}
            </time>
            {article.finishedAt && (
              <>
                <span aria-hidden="true" className="text-rule">
                  ·
                </span>
                <span className="tabular-nums">
                  {formatDuration(article.startedAt, article.finishedAt)}
                </span>
              </>
            )}
            {article.gitSha && (
              <>
                <span aria-hidden="true" className="text-rule">
                  ·
                </span>
                <span className="bg-paper px-1.5 py-0.5 tabular-nums" title={article.gitSha}>
                  {article.gitSha.slice(0, 7)}
                </span>
                {article.gitDirty && <span className="italic">(dirty)</span>}
              </>
            )}
          </p>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <Link
              href={`/runs/${article.runId}`}
              className="text-accent no-underline transition-colors hover:text-ink focus-visible:text-ink"
            >
              open run ↗
            </Link>
            <CopyButton content={article.contentMd} />
          </div>
        </div>
      </header>

      <div className="mt-10">
        <Markdown content={article.contentMd} withSectionOrdinals downgradeHeaderLevels={2} />
      </div>
    </article>
  );
}
