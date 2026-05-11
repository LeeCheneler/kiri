import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
   * Discard every loaded page and reload page one. Used by the
   * dashboard's lifecycle-event subscription to keep the live feed in
   * sync after a run starts, updates, or finishes.
   */
  refresh: () => void;
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

  const refresh = useCallback(() => {
    fetchPageOne();
  }, [fetchPageOne]);

  const runs = useMemo(() => pages.flat(), [pages]);
  const endReached = hasLoadedFirst && nextCursor === null;

  return { runs, pages, nextCursor, isLoading, error, endReached, loadNext, refresh };
}
