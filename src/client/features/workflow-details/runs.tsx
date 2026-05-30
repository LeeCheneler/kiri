import { useCallback, useRef } from "react";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { useWorkflowRunFeed } from "../../state/runs.ts";
import { RunRow } from "./run-row.tsx";

/**
 * The Runs tab body: one workflow's full run history as an infinite,
 * live-updating feed, newest first. Reads the cursor-paginated feed query
 * and renders one of loading, error, empty, or the run list. An
 * `IntersectionObserver` sentinel at the foot of the list loads the next
 * page as it scrolls into view; the feed stays current as runs start,
 * change, finish, and are deleted because the query is invalidated on those
 * events app-wide (see `useRunFeedsLive`).
 */
export function Runs({ workflowName }: { workflowName: string }) {
  const feed = useWorkflowRunFeed(workflowName);

  // The observer is created once when the sentinel mounts; a ref to the
  // latest feed lets its callback read current paging state without
  // re-subscribing on every render.
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
      <ul className="space-y-8">
        {runs.map((run) => (
          <li key={run.id}>
            <RunRow run={run} />
          </li>
        ))}
      </ul>
      {feed.hasNextPage ? (
        <div ref={sentinelRef} className="py-6 text-center">
          {feed.isFetchingNextPage ? (
            <output className="font-mono text-xs tracking-widest text-ink-muted uppercase">
              loading more…
            </output>
          ) : null}
        </div>
      ) : (
        <output className="block py-6 text-center font-mono text-xs tracking-widest text-ink-muted uppercase">
          end of feed
        </output>
      )}
    </div>
  );
}
