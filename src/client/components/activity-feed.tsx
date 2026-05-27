import type { Ref } from "react";
import { Link } from "wouter";
import type { ArticleSummary, RunListEntry } from "../api.ts";
import { formatDuration, formatRelativeTime } from "../formatters/format-time.ts";
import { Markdown } from "./markdown.tsx";
import { EmptyState } from "./ui/empty-state.tsx";
import { StatusLabel } from "./ui/status-label.tsx";
import { StatusStrip } from "./ui/status-strip.tsx";

/**
 * Activity feed: each run is one editorial entry, prefaced by a thin
 * status-coloured strip at the left edge. The entry is a single
 * column laid out as kicker → headline → body → articles:
 *
 *  - A small mono byline (status · time · duration) sits at the top
 *    as a kicker. The status word is the only colour in the line,
 *    making the row's outcome scannable from the top down.
 *  - The Fraunces workflow name follows as the headline, with a
 *    trailing `→` glyph. The headline is the row's sole click target;
 *    hovering tints its background and slides the arrow toward the
 *    accent gold.
 *  - The optional summary renders below as prose; markdown links
 *    inside it stay independent.
 *  - Published articles are a stacked list at the foot of the entry —
 *    one row per article — each link carrying the publish-entry title
 *    plus, when present, the article body's first markdown heading as
 *    a sub-byline so identically-titled articles from the same
 *    workflow are distinguishable.
 *
 * Runs in flight omit the duration entirely — the `running` status
 * label already pulses live. Rows stagger in on first paint. Empty
 * state is a single italic sentence.
 *
 * `sentinelRef` marks the bottom of the list so an
 * `IntersectionObserver` can trigger the next page load. `isLoadingMore`
 * shows a soft loading strip beneath the list while a page is in
 * flight; `endReached` swaps that for an end-of-feed indicator once
 * `nextCursor` is null.
 *
 * `now` is injectable so component tests render deterministic relative
 * timestamps; production callers omit it and pick up the system clock.
 */
export function ActivityFeed({
  runs,
  now,
  sentinelRef,
  isLoadingMore = false,
  endReached = false,
}: {
  runs: RunListEntry[];
  now?: Date;
  sentinelRef?: Ref<HTMLDivElement>;
  isLoadingMore?: boolean;
  endReached?: boolean;
}) {
  if (runs.length === 0) {
    return <EmptyState>no runs yet.</EmptyState>;
  }

  return (
    <>
      <ul className="divide-y divide-rule">
        {runs.map((run, index) => {
          const status = run.status;
          return (
            <li
              key={run.id}
              style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
              className="animate-[feed-row-in_320ms_ease-out_backwards]"
            >
              <div data-status={status} className="relative px-5 py-5">
                <StatusStrip status={status} />
                <div className="flex flex-wrap items-center gap-x-2 text-xs leading-none text-ink-muted">
                  <span className="tracking-wider">
                    <StatusLabel status={status} />
                  </span>
                  <span className="text-rule">·</span>
                  <span>{formatRelativeTime(run.startedAt, now)}</span>
                  {run.finishedAt && (
                    <>
                      <span className="text-rule">·</span>
                      <span className="tabular-nums">
                        {formatDuration(run.startedAt, run.finishedAt)}
                      </span>
                    </>
                  )}
                  {run.recommendationsCount > 0 && (
                    <>
                      <span className="text-rule">·</span>
                      <span>
                        {run.recommendationsCount === 1
                          ? "1 recommendation"
                          : `${run.recommendationsCount} recommendations`}
                      </span>
                    </>
                  )}
                  {run.isInterrupted && (
                    <>
                      <span className="text-rule">·</span>
                      <span className="italic">deleted</span>
                    </>
                  )}
                </div>
                <Link
                  href={`/runs/${run.id}`}
                  className="group/row-link mt-2 -mx-2 -my-1 flex items-baseline gap-2 rounded-sm px-2 py-1 font-display text-2xl leading-tight text-ink no-underline outline-none transition-colors hover:bg-paper focus-visible:bg-paper focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1"
                >
                  <span>{run.workflowName}</span>
                  <span
                    aria-hidden="true"
                    className="text-ink-muted transition-all duration-150 group-hover/row-link:translate-x-0.5 group-hover/row-link:text-accent group-focus-visible/row-link:text-accent"
                  >
                    →
                  </span>
                </Link>
                {run.summary && (
                  <div className="kiri-feed-summary mt-3 text-sm leading-snug text-ink [&_p]:mt-1 [&_p]:text-sm [&_p]:leading-snug [&_p]:first:mt-0 [&_ul]:mt-1 [&_ol]:mt-1">
                    <Markdown content={run.summary} />
                  </div>
                )}
                {run.articles.length > 0 && <ArticleList runId={run.id} articles={run.articles} />}
              </div>
            </li>
          );
        })}
      </ul>
      {endReached ? (
        <output className="block px-5 py-6 text-center font-mono text-xs tracking-widest text-ink-muted uppercase">
          end of feed
        </output>
      ) : (
        <div ref={sentinelRef} className="px-5 py-6 text-center">
          {isLoadingMore && (
            <output className="font-mono text-xs tracking-widest text-ink-muted uppercase">
              loading more…
            </output>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Stacked list of published articles for a feed row. Each entry is a
 * mini-headline — display-font title with a trailing arrow, mirroring
 * the parent run-link's affordance at a smaller scale so articles
 * read as nested destinations rather than body copy. The article
 * body's first markdown heading (when present) sits below as a muted
 * sub-byline so identically-titled articles from the same workflow
 * are distinguishable.
 */
function ArticleList({
  runId,
  articles,
}: {
  runId: string;
  articles: ArticleSummary[];
}) {
  return (
    <ul className="mt-3 space-y-1">
      {articles.map((article) => (
        <li key={article.name}>
          <Link
            href={`/runs/${runId}/published/${article.name}`}
            className="group/article -mx-2 block rounded-sm px-2 py-1.5 no-underline outline-none transition-colors hover:bg-paper focus-visible:bg-paper focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1"
          >
            <span className="flex items-baseline gap-2">
              <span className="font-display text-base leading-tight text-ink transition-colors group-hover/article:text-accent group-focus-visible/article:text-accent">
                {article.title}
              </span>
              <span
                aria-hidden="true"
                className="font-mono text-sm text-ink-muted transition-all duration-150 group-hover/article:translate-x-0.5 group-hover/article:text-accent group-focus-visible/article:text-accent"
              >
                →
              </span>
            </span>
            {article.heading !== null && (
              <span className="mt-1 block text-xs text-ink-muted">{article.heading}</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
