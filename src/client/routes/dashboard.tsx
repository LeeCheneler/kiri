import { useCallback, useRef } from "react";
import { ActivityFeed } from "../components/activity-feed.tsx";
import { useLiveSync } from "../events/live.tsx";
import { useRunFeed } from "../hooks/use-run-feed.ts";

/**
 * Dashboard route. Renders an editorial section header above the
 * paginated activity feed; owns only the loading and error states and
 * delegates the populated/empty rendering to `<ActivityFeed>`.
 *
 * Infinite scroll: an `IntersectionObserver` watches a sentinel near
 * the bottom of the feed and asks the hook to load the next page when
 * the sentinel enters the viewport. The hook coalesces overlapping
 * triggers so a slow page can't queue duplicate fetches.
 *
 * Live updates: lifecycle events trigger a page-one refresh through
 * the hook so new and updated runs surface without a reload.
 */
export function Dashboard() {
  const feed = useRunFeed();
  // Latest `loadNext` reference so the observer callback always calls
  // the freshest closure without re-creating the observer.
  const loadNextRef = useRef(feed.loadNext);
  loadNextRef.current = feed.loadNext;
  const refreshRef = useRef(feed.refresh);
  refreshRef.current = feed.refresh;
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Callback ref: React invokes this with the DOM node when the sentinel
  // mounts/unmounts. Using a callback ref instead of `useRef` + `useEffect`
  // means observer attachment tracks DOM identity directly — no stale
  // dependency arrays when the sentinel is replaced by the end-of-feed
  // element.
  const sentinelRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!el) {
      observerRef.current = null;
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadNextRef.current();
    });
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  const handleLifecycleEvent = useCallback(() => {
    refreshRef.current();
  }, []);
  useLiveSync({
    on: ["run.started", "run.updated", "run.finished"],
    refetch: handleLifecycleEvent,
  });

  return (
    <section>
      <header className="mb-6 flex items-baseline border-b border-rule pb-3">
        <h2 className="text-xs tracking-widest text-ink-muted uppercase">Activity</h2>
      </header>
      {feed.error ? (
        <p role="alert" className="text-status-failed">
          Failed to load runs: {feed.error.message}
        </p>
      ) : feed.isLoading && feed.runs.length === 0 ? (
        <p className="text-ink-muted italic">Loading runs…</p>
      ) : (
        <ActivityFeed
          runs={feed.runs}
          sentinelRef={sentinelRef}
          isLoadingMore={feed.isLoading}
          endReached={feed.endReached}
        />
      )}
    </section>
  );
}
