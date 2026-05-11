import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type RunListEntry, type RunsPage, fetchRunsPage } from "../api.ts";

/**
 * State surface for the paginated run feed: pages held individually
 * (newest first within each page; pages themselves ordered newest →
 * oldest) plus a flat array convenience and the current cursor + load
 * status. Components consume `runs` for rendering and call `loadNext`
 * when the user scrolls near the bottom.
 *
 * `endReached` is true when the last page came back with `nextCursor`
 * null and the initial load has completed — i.e. there's nothing more
 * to fetch.
 */
export interface RunFeed {
  runs: RunListEntry[];
  pages: RunListEntry[][];
  nextCursor: string | null;
  isLoading: boolean;
  error: Error | null;
  endReached: boolean;
  loadNext: () => void;
  /**
   * Insert a freshly-started run at the top of page one. If the run
   * is already in any loaded page (e.g. a duplicate event), patches
   * the existing row in place rather than producing a duplicate key.
   */
  prependRun: (run: RunListEntry) => void;
  /**
   * Replace an existing run row by `id`. No-op when the run isn't on
   * any loaded page — it'll surface naturally if the user scrolls to
   * its page or the feed merges on reconnect.
   */
  patchRun: (run: RunListEntry) => void;
  /**
   * Refetch page one and merge it into the top of the feed. Pages
   * below stay loaded; any runs in the fresh page that also appear in
   * deeper pages are removed from those deeper pages so the rendered
   * list has no duplicates. Wired to SSE reconnects so the feed
   * recovers from events missed while disconnected without losing
   * loaded scroll history.
   */
  mergePageOne: () => void;
}

/**
 * Override the API call (test seam). Production callers omit it and
 * the hook fetches via `fetchRunsPage` against the real backend.
 */
type FetchPage = (opts: { cursor?: string; limit?: number }) => Promise<RunsPage>;

/**
 * Paginated runs feed. Loads page one on mount and `loadNext()`
 * advances through subsequent pages using the server-provided
 * `nextCursor`. Concurrent `loadNext` calls are coalesced — a fetch in
 * flight short-circuits new requests so an intersection observer
 * sentinel can fire repeatedly without queueing duplicates.
 */
export function useRunFeed(opts: { fetchPage?: FetchPage } = {}): RunFeed {
  const fetchPage = opts.fetchPage ?? fetchRunsPage;
  const [pages, setPages] = useState<RunListEntry[][]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [hasLoadedFirst, setHasLoadedFirst] = useState(false);

  // Latest cursor for the next request, kept in a ref so `loadNext` can
  // read the most recent value without resubscribing the callback.
  const cursorRef = useRef<string | null>(null);
  // Token bumped on every fetch so stale resolutions can be ignored.
  const tokenRef = useRef(0);
  // Set while a fetch is in flight to coalesce duplicate `loadNext` calls.
  const inFlightRef = useRef(false);
  // Mirror of `pages.length` for callbacks that need to branch on it
  // outside the React update cycle. useLayoutEffect runs synchronously
  // after the DOM mutation so a callback triggered by a later render
  // sees the up-to-date value.
  const pagesLengthRef = useRef(0);
  useLayoutEffect(() => {
    pagesLengthRef.current = pages.length;
  }, [pages.length]);

  const fetchPageOne = useCallback(() => {
    // Bump the token first so any prior in-flight resolution is
    // discarded — callers can fire this repeatedly (e.g. on a burst of
    // lifecycle events) without stale resolutions clobbering state.
    const token = ++tokenRef.current;
    inFlightRef.current = true;
    setIsLoading(true);
    fetchPage({})
      .then((page) => {
        if (tokenRef.current !== token) return;
        cursorRef.current = page.nextCursor;
        setNextCursor(page.nextCursor);
        // Replace pages outright — refresh discards subsequent pages too,
        // matching the "scroll resets on hard reload" expectation.
        setPages([page.runs]);
        setError(null);
      })
      .catch((err: Error) => {
        if (tokenRef.current !== token) return;
        setError(err);
      })
      .finally(() => {
        if (tokenRef.current !== token) return;
        inFlightRef.current = false;
        setIsLoading(false);
        setHasLoadedFirst(true);
      });
  }, [fetchPage]);

  const appendPage = useCallback(
    (cursor: string) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const token = ++tokenRef.current;
      setIsLoading(true);
      fetchPage({ cursor })
        .then((page) => {
          if (tokenRef.current !== token) return;
          cursorRef.current = page.nextCursor;
          setNextCursor(page.nextCursor);
          setPages((prev) => [...prev, page.runs]);
          setError(null);
        })
        .catch((err: Error) => {
          if (tokenRef.current !== token) return;
          setError(err);
        })
        .finally(() => {
          if (tokenRef.current !== token) return;
          inFlightRef.current = false;
          setIsLoading(false);
          setHasLoadedFirst(true);
        });
    },
    [fetchPage],
  );

  useEffect(() => {
    fetchPageOne();
    return () => {
      // Bump the token so any in-flight resolution from this mount is
      // ignored if the hook unmounts before it lands.
      tokenRef.current++;
      inFlightRef.current = false;
    };
  }, [fetchPageOne]);

  const loadNext = useCallback(() => {
    const cursor = cursorRef.current;
    if (cursor === null) return;
    appendPage(cursor);
  }, [appendPage]);

  const prependRun = useCallback((run: RunListEntry) => {
    setPages((prev) => {
      if (prev.length === 0) return [[run]];
      // Already loaded somewhere → patch in place to avoid a duplicate
      // React key. Run.started can fire more than once for the same id
      // (e.g. SSE reconnect replay), and rerunning a row would shuffle
      // the user's view.
      for (let i = 0; i < prev.length; i++) {
        const idx = prev[i].findIndex((r) => r.id === run.id);
        if (idx !== -1) {
          const next = prev.slice();
          const page = prev[i].slice();
          page[idx] = run;
          next[i] = page;
          return next;
        }
      }
      return [[run, ...prev[0]], ...prev.slice(1)];
    });
  }, []);

  const patchRun = useCallback((run: RunListEntry) => {
    setPages((prev) => {
      for (let i = 0; i < prev.length; i++) {
        const idx = prev[i].findIndex((r) => r.id === run.id);
        if (idx !== -1) {
          const next = prev.slice();
          const page = prev[i].slice();
          page[idx] = run;
          next[i] = page;
          return next;
        }
      }
      return prev;
    });
  }, []);

  const mergePageOne = useCallback(() => {
    // mergePageOne owns the in-flight slot the same way fetchPageOne
    // does — a parallel loadNext is cancelled when the token bumps.
    const token = ++tokenRef.current;
    inFlightRef.current = true;
    setIsLoading(true);
    // Capture pages.length at call time. Between now and the response
    // landing no other fetch resolves (the token bump cancelled them),
    // so this read is consistent with the state we'll be merging into.
    const wasSinglePage = pagesLengthRef.current <= 1;
    fetchPage({})
      .then((page) => {
        if (tokenRef.current !== token) return;
        setPages((prev) => {
          if (prev.length <= 1) return [page.runs];
          const freshIds = new Set(page.runs.map((r) => r.id));
          const olderPages = prev.slice(1).map((p) => p.filter((r) => !freshIds.has(r.id)));
          return [page.runs, ...olderPages];
        });
        // Only re-anchor the cursor when fresh page one is also the
        // deepest loaded page; otherwise the existing cursor still
        // points past the deepest page and is the right thing to keep.
        if (wasSinglePage) {
          cursorRef.current = page.nextCursor;
          setNextCursor(page.nextCursor);
        }
        setError(null);
      })
      .catch((err: Error) => {
        if (tokenRef.current !== token) return;
        setError(err);
      })
      .finally(() => {
        if (tokenRef.current !== token) return;
        inFlightRef.current = false;
        setIsLoading(false);
        setHasLoadedFirst(true);
      });
  }, [fetchPage]);

  const runs = useMemo(() => pages.flat(), [pages]);
  const endReached = hasLoadedFirst && nextCursor === null;

  return {
    runs,
    pages,
    nextCursor,
    isLoading,
    error,
    endReached,
    loadNext,
    prependRun,
    patchRun,
    mergePageOne,
  };
}
