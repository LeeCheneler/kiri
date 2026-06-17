import { useCallback, useRef } from "react";
import type { ActivityEntry } from "../../api.ts";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { Rule } from "../../design-system/content/rule.tsx";
import { formatDayMarker } from "../../formatters/format-time.ts";
import { SessionRow } from "../session-chat/session-row.tsx";
import { RunRow } from "../workflow-details/run-row.tsx";

/**
 * The normalised paging state a `Feed` renders, decoupled from which query
 * produced it so the same feed serves the union, runs-only, and sessions-only
 * views. `fetchNextPage` is void-returning — the feed only ever fires it.
 */
export interface FeedState {
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  entries: ActivityEntry[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

const entryStartedAt = (entry: ActivityEntry) =>
  entry.kind === "run" ? entry.run.startedAt : entry.session.startedAt;

const entryKey = (entry: ActivityEntry) =>
  entry.kind === "run" ? `run:${entry.run.id}` : `session:${entry.session.id}`;

type DayGroup = { marker: string; entries: ActivityEntry[] };

// Segment the newest-first stream into contiguous local-day buckets. Entries of
// one day are adjacent, so a marker change is a bucket boundary; the marker text
// is unique per calendar day, so it doubles as the group's React key.
const groupByDay = (entries: ActivityEntry[], now?: Date): DayGroup[] => {
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
 * of runs and sessions, segmented by day marker (Today / Yesterday / date), each
 * entry rendered as its kind's row. An `IntersectionObserver` sentinel at the
 * foot loads the next page as it scrolls into view. Renders one of loading,
 * error, empty, or the grouped list. The caller supplies the normalised `state`
 * and a `noun` for the loading/error/empty copy ("activity", "runs", "sessions").
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
    return <p className="font-mono text-sm text-ink-muted">Loading {noun}…</p>;
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
                ) : (
                  <SessionRow session={entry.session} now={now} />
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
