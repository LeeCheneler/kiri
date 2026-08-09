import { useCallback, useRef } from "react";
import type { ActivityEntry, ArticleFeedEntry } from "../../api.ts";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Rule } from "../../design-system/content/rule.tsx";
import { formatDayMarker } from "../../formatters/format-time.ts";
import { SessionRow } from "../session-chat/session-row.tsx";
import { RunRow } from "../workflow-details/run-row.tsx";
import { ArticleRow } from "./article-row.tsx";

/**
 * One row a `Feed` can render. Widens the `/api/activity` union with the
 * articles view's own kind — that endpoint returns runs and sessions only, so
 * the extra arm lives here rather than being folded into `ActivityEntry`.
 */
export type FeedEntry = ActivityEntry | { kind: "article"; article: ArticleFeedEntry };

/**
 * The normalised paging state a `Feed` renders, decoupled from which query
 * produced it so the same feed serves the union, runs-only, sessions-only, and
 * articles-only views. `fetchNextPage` is void-returning — the feed only ever
 * fires it.
 */
export interface FeedState {
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  entries: FeedEntry[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

// An article's place in the timeline is when it was written; runs and sessions
// are placed by when they began.
const entryStartedAt = (entry: FeedEntry) => {
  switch (entry.kind) {
    case "run":
      return entry.run.startedAt;
    case "session":
      return entry.session.startedAt;
    case "article":
      return entry.article.createdAt;
  }
};

// An article has no id of its own in the feed — its slug is unique only within
// the container that owns it, so the pair is the key.
const entryKey = (entry: FeedEntry) => {
  switch (entry.kind) {
    case "run":
      return `run:${entry.run.id}`;
    case "session":
      return `session:${entry.session.id}`;
    case "article":
      return `article:${entry.article.producer.id}:${entry.article.slug}`;
  }
};

type DayGroup = { marker: string; entries: FeedEntry[] };

// Segment the newest-first stream into contiguous local-day buckets. Entries of
// one day are adjacent, so a marker change is a bucket boundary; the marker text
// is unique per calendar day, so it doubles as the group's React key.
const groupByDay = (entries: FeedEntry[], now?: Date): DayGroup[] => {
  const groups: DayGroup[] = [];
  for (const entry of entries) {
    const marker = formatDayMarker(entryStartedAt(entry), now);
    const last = groups.at(-1);
    if (last?.marker === marker) last.entries.push(entry);
    else groups.push({ marker, entries: [entry] });
  }
  return groups;
};

/**
 * Presentational activity feed: a live, infinite, reverse-chronological stream
 * of runs, sessions, and articles, segmented by day marker (Today / Yesterday /
 * date), each entry rendered as its kind's row. An `IntersectionObserver`
 * sentinel at the foot loads the next page as it scrolls into view. Renders one
 * of loading, error, empty, or the grouped list. The caller supplies the
 * normalised `state` and a `noun` for the loading/error/empty copy
 * ("activity", "runs", "sessions", "articles").
 * `now` is injectable so tests render deterministic day markers and relative
 * times; production omits it.
 */
export function Feed({
  state,
  noun,
  now,
}: {
  state: FeedState;
  noun: string;
  now?: Date;
}) {
  // The observer is created once when the sentinel mounts; a ref to the latest
  // state lets its callback read current paging state without re-subscribing on
  // every render.
  const stateRef = useRef(state);
  stateRef.current = state;
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!el) {
      observerRef.current = null;
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const current = stateRef.current;
      if (entries.some((entry) => entry.isIntersecting) && !current.isFetchingNextPage) {
        current.fetchNextPage();
      }
    });
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  if (state.isPending) {
    return <LoadingState>Loading {noun}…</LoadingState>;
  }
  if (state.isError) {
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        Failed to load {noun}: {state.error?.message}
      </p>
    );
  }
  if (state.entries.length === 0) {
    return <EmptyState>no {noun} yet.</EmptyState>;
  }

  return (
    <div>
      {groupByDay(state.entries, now).map((group) => (
        <section key={group.marker} className="mb-10">
          <div className="mb-3">
            <Eyebrow tone="muted">{group.marker}</Eyebrow>
          </div>
          <Rule />
          <ul className="mt-6 space-y-8">
            {group.entries.map((entry) => (
              <li key={entryKey(entry)}>
                {entry.kind === "run" ? (
                  <RunRow run={entry.run} now={now} showWorkflow />
                ) : entry.kind === "session" ? (
                  <SessionRow session={entry.session} now={now} />
                ) : (
                  <ArticleRow article={entry.article} now={now} />
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {state.hasNextPage ? (
        <div ref={sentinelRef} className="py-6 text-center">
          {state.isFetchingNextPage ? (
            <output className="font-mono text-xs text-ink-muted uppercase tracking-widest">
              loading more…
            </output>
          ) : null}
        </div>
      ) : (
        <output className="block py-6 text-center font-mono text-xs text-ink-muted uppercase tracking-widest">
          end of feed
        </output>
      )}
    </div>
  );
}
