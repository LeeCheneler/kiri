import {
  type UseInfiniteQueryResult,
  type UseQueryResult,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  type ModelsResult,
  type Session,
  type SessionDetail,
  type SessionListEntry,
  fetchModels,
  fetchSession,
  fetchSessionChildren,
  fetchSessionsPage,
  patchSessionImageModel,
  patchSessionModel,
  patchSessionPinned,
} from "../api.ts";
import { useLiveEvent, useLiveReconnect } from "../events/live.tsx";

const sessionKey = (id: string) => ["session", id] as const;
// Keyed by the parent under its own subtree, not under `sessionKey`: a child's
// lifecycle events carry the child's id, so the live bridge invalidates this
// whole subtree rather than deriving which parent a child event belongs to.
const sessionChildrenKey = (id: string) => ["session-children", id] as const;
const sessionsFeedKey = ["sessions", "feed"] as const;
const modelsKey = ["models"] as const;

/** Page size for the session feed; mirrors the server's default. */
const FEED_PAGE_SIZE = 25;

/**
 * Read the available models for the picker. Fetches on first use and serves the
 * cache thereafter. A `kiri.yaml` edit swaps the provider registry and publishes
 * `config.changed`, which `useConfigHealthLive` bridges to this query's key — so
 * the picker follows provider edits without a restart.
 */
export function useModels(): UseQueryResult<ModelsResult> {
  return useQuery({ queryKey: modelsKey, queryFn: fetchModels });
}

/**
 * Read a single session with its messages, fetching on first use and serving
 * the cache thereafter. Kept current by `useSessionsLive`, so the status and
 * token totals refresh as turns run without a manual refetch.
 */
export function useSession(id: string): UseQueryResult<SessionDetail> {
  return useQuery({ queryKey: sessionKey(id), queryFn: () => fetchSession(id) });
}

/**
 * Read the child sessions a session's delegate calls have spawned, oldest
 * first. Fetches on first use and serves the cache thereafter; kept current by
 * `useSessionsLive`, which refetches it as children start, stream, and settle.
 */
export function useSessionChildren(id: string): UseQueryResult<Session[]> {
  return useQuery({ queryKey: sessionChildrenKey(id), queryFn: () => fetchSessionChildren(id) });
}

/**
 * Change a session's model, image model, or pinned flag and write the
 * server's updated row straight into the cached detail, so the control
 * reflects the choice at once. A user-initiated change shouldn't wait on the
 * `session.updated` echo to land before showing — the PATCH already returns
 * the authoritative session; we keep the loaded messages and swap it in.
 */
export function useUpdateSession(id: string): {
  setModel: (model: string) => Promise<void>;
  setImageModel: (imageModel: string | null) => Promise<void>;
  setPinned: (pinned: boolean) => Promise<void>;
} {
  const queryClient = useQueryClient();
  const apply = (session: Session) => {
    queryClient.setQueryData<SessionDetail>(sessionKey(id), (prev) =>
      prev ? { ...prev, session } : prev,
    );
  };
  return {
    setModel: async (model) => apply((await patchSessionModel(id, model)).session),
    setImageModel: async (imageModel) =>
      apply((await patchSessionImageModel(id, imageModel)).session),
    setPinned: async (pinned) => apply((await patchSessionPinned(id, pinned)).session),
  };
}

/**
 * Read the full session history as an infinite, cursor-paginated feed, newest
 * first — or, with `pinned: true`, just the pinned sessions. The first page
 * fetches on mount; `fetchNextPage` advances by the previous page's
 * `nextCursor` until it runs dry. `data` is the loaded pages flattened into
 * one newest-first array. Both variants key under `["sessions", "feed"]`, so
 * `useSessionsLive`'s subtree invalidations keep them current.
 */
export function useSessionsFeed(
  opts: { pinned?: true } = {},
): UseInfiniteQueryResult<SessionListEntry[], Error> {
  return useInfiniteQuery({
    queryKey: opts.pinned ? ([...sessionsFeedKey, "pinned"] as const) : sessionsFeedKey,
    queryFn: ({ pageParam }) =>
      fetchSessionsPage({ cursor: pageParam, limit: FEED_PAGE_SIZE, pinned: opts.pinned }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    select: (data) => data.pages.flatMap((page) => page.sessions),
  });
}

/**
 * Bridge session lifecycle events to the query cache: invalidate a session's
 * cached detail when it changes, and the whole `["sessions", "feed"]` subtree as
 * sessions start, take a turn, or finish, so mounted surfaces refetch and
 * reflect the change. The live transcript itself is owned by `useChat`, not this
 * cache — these invalidations keep the session list and a session's status/token
 * metadata current. Reconnect re-syncs both. Mount once near the root via
 * `<LiveSync>`.
 */
export function useSessionsLive(): void {
  const queryClient = useQueryClient();
  useLiveEvent({
    on: [
      "session.started",
      "session.message.added",
      "session.updated",
      "session.finished",
      "session.deleted",
    ],
    handler: (event) => {
      const id = "sessionId" in event ? event.sessionId : event.id;
      void queryClient.invalidateQueries({ queryKey: sessionKey(id) });
      void queryClient.invalidateQueries({ queryKey: sessionsFeedKey });
      // A child's events carry the child's id, not its parent's, so refetch
      // every mounted children lookup — at most the open session page's one
      // light query — rather than deriving the parent here.
      void queryClient.invalidateQueries({ queryKey: ["session-children"] });
    },
  });
  useLiveReconnect(() => {
    void queryClient.invalidateQueries({ queryKey: ["session"] });
    void queryClient.invalidateQueries({ queryKey: sessionsFeedKey });
    void queryClient.invalidateQueries({ queryKey: ["session-children"] });
  });
}
