import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { type RecentArticle, fetchRecentArticles } from "../api.ts";
import { useLiveSync } from "../events/live.tsx";
import { formatRelativeTime } from "../formatters/format-time.ts";
import { EmptyState } from "./ui/empty-state.tsx";
import { RailLink } from "./ui/rail-link.tsx";

/**
 * Right-rail "Recently Published" section: a glance-able shortlist of the
 * most recent articles across all runs, each linking to its dedicated
 * article page. Self-contained — owns its own fetch and refetches live
 * as runs finish or are deleted, and on event-stream reconnect.
 *
 * Like the left rail's nav, this is non-essential chrome: a failed fetch
 * renders nothing rather than surfacing an error in the rail. Once a
 * fetch resolves the section always renders, falling back to an
 * empty-state sentence when nothing has been published yet.
 *
 * `now` is injectable so component tests render deterministic relative
 * timestamps; production callers omit it and pick up the system clock.
 */
export function RecentlyPublished({ now }: { now?: Date }) {
  const [articles, setArticles] = useState<RecentArticle[] | null>(null);
  const [location] = useLocation();
  // Bumped on every fetch so a stale resolution — overlapping live-event
  // refetches, or an unmount mid-flight — can't clobber fresher state.
  const tokenRef = useRef(0);

  const refetch = useCallback(() => {
    const token = ++tokenRef.current;
    fetchRecentArticles()
      .then((all) => {
        if (tokenRef.current !== token) return;
        setArticles(all);
      })
      .catch(() => {
        // Non-essential chrome — hide the section on failure rather than
        // surface a fetch error in the rail.
      });
  }, []);

  useEffect(() => {
    refetch();
    return () => {
      tokenRef.current++;
    };
  }, [refetch]);

  // Articles are persisted before a run finalises, so run.finished is a
  // sound signal that a run's articles exist; run.deleted cascades their
  // removal. useLiveSync also refetches on reconnect.
  useLiveSync({ on: ["run.finished", "run.deleted"], refetch });

  if (articles === null) return null;

  return (
    <section aria-labelledby="recently-published-heading">
      <h2
        id="recently-published-heading"
        className="mb-3 text-xs tracking-widest text-ink-muted uppercase"
      >
        Recently Published
      </h2>
      {articles.length === 0 ? (
        <EmptyState>no articles published yet.</EmptyState>
      ) : (
        <ul>
          {articles.map((article, index) => {
            const href = `/runs/${article.runId}/published/${article.name}`;
            return (
              <li
                key={`${article.runId}/${article.name}`}
                style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
                className="animate-[feed-row-in_320ms_ease-out_backwards]"
              >
                <RailLink href={href} active={location === href}>
                  {article.title}
                  {article.heading !== null && (
                    <span className="mt-1 block text-xs text-ink-muted">{article.heading}</span>
                  )}
                  <span className="mt-1 block font-mono text-xs text-ink-muted">
                    {article.workflowName} · {formatRelativeTime(article.createdAt, now)}
                  </span>
                </RailLink>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
