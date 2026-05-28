import { useCallback, useRef } from "react";
import { fetchRun } from "../api.ts";
import { useLiveEvent, useLiveReconnect } from "../events/live.tsx";
import { useRunFeed } from "../hooks/use-run-feed.ts";
import { ActivityFeed } from "./activity-feed.tsx";
import { LoadingState } from "./ui/loading-state.tsx";

/**
 * The Recent runs tab body: the paginated run feed scoped to one
 * workflow. Mirrors the dashboard feed — infinite scroll via an
 * `IntersectionObserver` sentinel plus live `run.*` updates — but every
 * fetch is filtered to `workflowName`. Because the events bus is
 * app-wide, a freshly-started run is only prepended when it belongs to
 * this workflow; updates and deletes for other workflows fall through
 * harmlessly since the patch/remove helpers no-op for unloaded runs.
 */
export function WorkflowRecentRuns({ workflowName }: { workflowName: string }) {
  const feed = useRunFeed({ workflow: workflowName });
  // Latest callback references so the observer/event handlers always call
  // the freshest closure without re-subscribing.
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
      // The payload carries only the id; resolve the row to learn its
      // workflow and prepend only when it's ours. A failed fetch (e.g. the
      // run was deleted before we reached it) is logged and dropped — the
      // next reconnect merge reconciles.
      fetchRun(event.id)
        .then((detail) => {
          if (detail.run.workflowName === workflowName) prependRef.current(detail.run);
        })
        .catch((err: Error) => console.error(`run.started fetch failed: ${err.message}`));
    },
  });
  useLiveEvent({
    on: ["run.updated", "run.finished"],
    handler: (event) => {
      // `run.finished` carries the workflow name, so skip the round-trip
      // outright for other workflows; `run.updated` has no name, but
      // patchRun no-ops when the run isn't on a loaded page.
      if (event.type === "run.finished" && event.workflowName !== workflowName) return;
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

  if (feed.error) {
    return (
      <p role="alert" className="text-status-failed">
        Failed to load runs: {feed.error.message}
      </p>
    );
  }
  if (feed.isLoading && feed.runs.length === 0) {
    return <LoadingState>Loading runs…</LoadingState>;
  }
  return (
    <ActivityFeed
      runs={feed.runs}
      variant="workflow"
      sentinelRef={sentinelRef}
      isLoadingMore={feed.isLoading}
      endReached={feed.endReached}
    />
  );
}
