import { useCallback, useRef } from "react";
import type { RunListEntry } from "../../api.ts";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { Rule } from "../../design-system/content/rule.tsx";
import { formatDayMarker } from "../../formatters/format-time.ts";
import { useRunFeed } from "../../state/runs.ts";
import { RunRow } from "../workflow-details/run-row.tsx";

type DayGroup = { marker: string; runs: RunListEntry[] };

// Segment the newest-first feed into contiguous local-day buckets. Runs of one
// day are adjacent, so a marker change is a bucket boundary; the marker text is
// unique per calendar day, so it doubles as the group's React key.
const groupByDay = (runs: RunListEntry[], now?: Date): DayGroup[] => {
  const groups: DayGroup[] = [];
  for (const run of runs) {
    const marker = formatDayMarker(run.startedAt, now);
    const last = groups.at(-1);
    if (last?.marker === marker) last.runs.push(run);
    else groups.push({ marker, runs: [run] });
  }
  return groups;
};

/**
 * The home activity feed: every workflow's runs as one live, infinite,
 * reverse-chronological stream, segmented by day marker (Today / Yesterday /
 * date). Reads the unscoped run feed and renders one of loading, error, empty,
 * or the grouped run list; an `IntersectionObserver` sentinel at the foot loads
 * the next page as it scrolls into view, and the feed stays current as runs
 * start, change, finish, and are deleted (see `useRunFeedsLive`). Each row names
 * its workflow, since the stream spans them all. `now` is injectable so tests
 * render deterministic day markers and relative times; production omits it.
 */
export function ActivityFeed({ now }: { now?: Date }) {
  const feed = useRunFeed();

  // The observer is created once when the sentinel mounts; a ref to the latest
  // feed lets its callback read current paging state without re-subscribing on
  // every render.
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!el) {
      observerRef.current = null;
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const current = feedRef.current;
      if (entries.some((entry) => entry.isIntersecting) && !current.isFetchingNextPage) {
        void current.fetchNextPage();
      }
    });
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  if (feed.isPending) {
    return <p className="font-mono text-sm text-ink-muted">Loading runs…</p>;
  }
  if (feed.isError) {
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        Failed to load runs: {feed.error.message}
      </p>
    );
  }
  const runs = feed.data;
  if (runs.length === 0) {
    return <EmptyState>no runs yet.</EmptyState>;
  }

  return (
    <div>
      {groupByDay(runs, now).map((group) => (
        <section key={group.marker} className="mb-10">
          <p className="mb-3 font-mono text-xs text-ink-muted uppercase tracking-widest">
            {group.marker}
          </p>
          <Rule />
          <ul className="mt-6 space-y-8">
            {group.runs.map((run) => (
              <li key={run.id}>
                <RunRow run={run} now={now} showWorkflow />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {feed.hasNextPage ? (
        <div ref={sentinelRef} className="py-6 text-center">
          {feed.isFetchingNextPage ? (
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
