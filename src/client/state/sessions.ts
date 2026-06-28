import {
  type UseInfiniteQueryResult,
  type UseQueryResult,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  type ModelsResult,
  type Persona,
  type Session,
  type SessionDetail,
  type SessionListEntry,
  fetchModels,
  fetchPersonas,
  fetchSession,
  fetchSessionsPage,
  getOrCreateChildSession,
  patchSessionModel,
  patchSessionPersona,
} from "../api.ts";
import { useLiveEvent, useLiveReconnect } from "../events/live.tsx";

const sessionKey = (id: string) => ["session", id] as const;
const sessionsFeedKey = ["sessions", "feed"] as const;
const modelsKey = ["models"] as const;
const personasKey = ["personas"] as const;

/** Page size for the session feed; mirrors the server's default. */
const FEED_PAGE_SIZE = 25;

/**
 * Read the available models for the picker. Fetches on first use and serves the
 * cache thereafter — there is no live-sync because provider config is read once
 * at startup and fixed for the process lifetime (restart kiri to pick up edits).
 */
export function useModels(): UseQueryResult<ModelsResult> {
  return useQuery({ queryKey: modelsKey, queryFn: fetchModels });
}

/**
 * Read the personas available to attach at session creation. Like the models
 * list, this is fetched on first use and served from cache — personas are
 * workspace files read per turn on the server, so the picker need not live-sync;
 * a restart (or cache invalidation) refreshes it.
 */
export function usePersonas(): UseQueryResult<Persona[]> {
  return useQuery({ queryKey: personasKey, queryFn: fetchPersonas });
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
 * Resolve the child session a parent's client-completed tool call spawned,
 * creating it on first use (idempotent server-side) and caching it so a
 * re-render or reload re-attaches the same child rather than starting another.
 * The child id is stable, so this never refetches; the child's live transcript is
 * read through `useSession` and driven by `useSessionConversation`.
 */
export function useChildSession(
  parentSessionId: string,
  toolCallId: string,
): UseQueryResult<Session> {
  return useQuery({
    queryKey: ["child-session", parentSessionId, toolCallId] as const,
    queryFn: () => getOrCreateChildSession(parentSessionId, toolCallId).then((r) => r.session),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * Change a session's model or persona and write the server's updated row
 * straight into the cached detail, so the picker reflects the choice at once.
 * A user-initiated change shouldn't wait on the `session.updated` echo to land
 * before showing — the PATCH already returns the authoritative session; we keep
 * the loaded messages and swap it in.
 */
export function useUpdateSession(id: string): {
  setModel: (model: string) => Promise<void>;
  setPersona: (persona: string | null) => Promise<void>;
} {
  const queryClient = useQueryClient();
  const apply = (session: Session) => {
    queryClient.setQueryData<SessionDetail>(sessionKey(id), (prev) =>
      prev ? { ...prev, session } : prev,
    );
  };
  return {
    setModel: async (model) => apply((await patchSessionModel(id, model)).session),
    setPersona: async (persona) => apply((await patchSessionPersona(id, persona)).session),
  };
}

/**
 * Read the full session history as an infinite, cursor-paginated feed, newest
 * first. The first page fetches on mount; `fetchNextPage` advances by the
 * previous page's `nextCursor` until it runs dry. `data` is the loaded pages
 * flattened into one newest-first array. Kept current by `useSessionsLive`.
 */
export function useSessionsFeed(): UseInfiniteQueryResult<SessionListEntry[], Error> {
  return useInfiniteQuery({
    queryKey: sessionsFeedKey,
    queryFn: ({ pageParam }) => fetchSessionsPage({ cursor: pageParam, limit: FEED_PAGE_SIZE }),
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
    },
  });
  useLiveReconnect(() => {
    void queryClient.invalidateQueries({ queryKey: ["session"] });
    void queryClient.invalidateQueries({ queryKey: sessionsFeedKey });
  });
}
