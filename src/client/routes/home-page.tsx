import { useCallback, useRef } from "react";
import { fetchRun } from "../api.ts";
import { ActivityFeed } from "../components/activity-feed.tsx";
import { RecentlyPublished } from "../components/recently-published.tsx";
import { LoadingState } from "../components/ui/loading-state.tsx";
import { useLiveEvent, useLiveReconnect } from "../events/live.tsx";
import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";
import { useRunFeed } from "../hooks/use-run-feed.ts";

/**
 * Home route. Composes the activity feed into the page shell, with the
 * cross-run recently-published shortlist as right-rail marginalia.
 */
export function HomePage() {
  return (
    <PageShell left={<SiteNav />} right={<RecentlyPublished />}>
      <HomeContent />
    </PageShell>
  );
}

/**
 * Activity feed content. Renders an editorial section header above the
 * paginated activity feed; owns only the loading and error states and
 * delegates the populated/empty rendering to `<ActivityFeed>`.
 *
 * Infinite scroll: an `IntersectionObserver` watches a sentinel near
 * the bottom of the feed and asks the hook to load the next page when
 * the sentinel enters the viewport. The hook coalesces overlapping
 * triggers so a slow page can't queue duplicate fetches.
 *
 * Live updates: `run.started` events prepend the new run to page one;
 * `run.updated` / `run.finished` patch the matching row in whichever
 * loaded page holds it (no-op if the user hasn't scrolled to it yet).
 * SSE reconnects trigger a page-one refetch + merge so the feed
 * recovers any rows that arrived while disconnected without losing
 * loaded pages below.
 */
export function HomeContent() {
  const feed = useRunFeed();
  // Latest `loadNext` reference so the observer callback always calls
  // the freshest closure without re-creating the observer.
  const loadNextRef = useRef(feed.loadNext);
  loadNextRef.current = feed.loadNext;
  const prependRef = useRef(feed.prependRun);
  prependRef.current = feed.prependRun;
  const patchRef = useRef(feed.patchRun);
  patchRef.current = feed.patchRun;
  const removeRef = useRef(feed.removeRun);
  removeRef.current = feed.removeRun;
  const mergePageOneRef = useRef(feed.mergePageOne);
  mergePageOneRef.current = feed.mergePageOne;
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

  useLiveEvent({
    on: ["run.started"],
    handler: (event) => {
      // Bus payload only carries the id; resolve the row for the
      // prepend. A failed fetch (e.g. the run was deleted before we
      // could reach it) is logged and dropped — the next reconnect
      // merge will reconcile.
      fetchRun(event.id)
        .then((detail) => prependRef.current(detail.run))
        .catch((err: Error) => console.error(`run.started fetch failed: ${err.message}`));
    },
  });
  useLiveEvent({
    on: ["run.updated", "run.finished"],
    handler: (event) => {
      fetchRun(event.id)
        .then((detail) => patchRef.current(detail.run))
        .catch((err: Error) => console.error(`run.updated fetch failed: ${err.message}`));
    },
  });
  useLiveEvent({
    on: ["run.deleted"],
    handler: (event) => removeRef.current(event.id),
  });
  useLiveReconnect(useCallback(() => mergePageOneRef.current(), []));

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
        <LoadingState>Loading runs…</LoadingState>
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
