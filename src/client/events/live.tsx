import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef } from "react";

/** All event types pushed by the server's in-process bus over `/api/events`. */
export type KiriEventType =
  | "run.started"
  | "run.updated"
  | "run.step.updated"
  | "run.finished"
  | "run.deleted"
  | "recommendation.actioned"
  | "recommendation.updated"
  | "session.started"
  | "session.message.added"
  | "session.updated"
  | "session.finished"
  | "session.deleted"
  | "article.written"
  | "project.created"
  | "project.updated"
  | "project.deleted"
  | "memory.saved"
  | "memory.deleted"
  | "workflow.added"
  | "workflow.updated"
  | "workflow.removed"
  | "tool.permission.updated"
  | "config.changed";

/** Session lifecycle states; `idle` is the between-turns resting state, replacing a run's terminal `ok`. */
type SessionStatus = "running" | "idle" | "failed" | "cancelled";

/** Mirrors the server's discriminated union; payloads are thin invalidation signals. */
export type KiriEvent =
  | { type: "run.started"; id: string }
  | { type: "run.updated"; id: string; status: "running" | "ok" | "failed" | "cancelled" }
  | {
      type: "run.step.updated";
      runId: string;
      step: number;
      status: "running" | "ok" | "failed" | "cancelled";
    }
  | { type: "run.finished"; id: string; status: "running" | "ok" | "failed" | "cancelled" }
  | { type: "run.deleted"; id: string }
  | {
      type: "recommendation.actioned";
      runId: string;
      recommendationId: string;
      actionedRunId: string;
    }
  | {
      type: "recommendation.updated";
      runId: string;
      recommendationId: string;
      actionedRunId: string;
      status: "running" | "ok" | "failed" | "cancelled";
    }
  | { type: "session.started"; id: string }
  | { type: "session.message.added"; sessionId: string }
  | { type: "session.updated"; id: string; status: SessionStatus }
  | { type: "session.finished"; id: string; status: SessionStatus }
  | { type: "session.deleted"; id: string }
  | { type: "article.written"; sessionId: string; slug: string }
  | { type: "project.created"; id: string }
  | { type: "project.updated"; id: string }
  | { type: "project.deleted"; id: string }
  | { type: "memory.saved"; name: string }
  | { type: "memory.deleted"; name: string }
  | { type: "workflow.added"; name: string }
  | { type: "workflow.updated"; name: string }
  | { type: "workflow.removed"; name: string }
  | { type: "tool.permission.updated"; tool: string }
  | { type: "config.changed" };

/** Minimal `EventSource` surface so tests can swap in a controllable fake. */
export interface EventSourceLike {
  addEventListener(type: string, handler: (event: MessageEvent) => void): void;
  removeEventListener(type: string, handler: (event: MessageEvent) => void): void;
  close(): void;
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
}

/** Constructor seam: production wraps `new EventSource(url)`; tests inject a fake. */
export type EventSourceFactory = (url: string) => EventSourceLike;

const KIRI_EVENT_TYPES: readonly KiriEventType[] = [
  "run.started",
  "run.updated",
  "run.step.updated",
  "run.finished",
  "run.deleted",
  "recommendation.actioned",
  "recommendation.updated",
  "session.started",
  "session.message.added",
  "session.updated",
  "session.finished",
  "session.deleted",
  "article.written",
  "project.created",
  "project.updated",
  "project.deleted",
  "memory.saved",
  "memory.deleted",
  "workflow.added",
  "workflow.updated",
  "workflow.removed",
  "tool.permission.updated",
  "config.changed",
];

const KIRI_ORIGIN = "http://127.0.0.1:4242";

const eventsUrl = (): string => {
  const localhost =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  return `${localhost ? "" : KIRI_ORIGIN}/api/events`;
};

const defaultFactory: EventSourceFactory = (url) => new EventSource(url);

/** `EventSource.CLOSED`: the browser has abandoned the stream and will not retry it. */
const CLOSED = 2;

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

interface Subscriber {
  types: Set<KiriEventType>;
  filter: ((event: KiriEvent) => boolean) | undefined;
  onEvent: ((event: KiriEvent) => void) | undefined;
  onReconnect: (() => void) | undefined;
}

interface LiveEventsContextValue {
  subscribe: (subscriber: Subscriber) => () => void;
}

const LiveEventsContext = createContext<LiveEventsContextValue | null>(null);

/**
 * Owns the single `EventSource('/api/events')` for the app and fans incoming
 * events out to subscribers registered via `useLiveSync`. On every reconnect,
 * every subscriber's `refetch` fires so the UI recovers from any events missed
 * while disconnected. Only the page's first open is silent — surfaces fetch on
 * mount — and a stream rebuilt after a failure counts as a reconnect even when
 * the original never opened.
 *
 * A stream the browser abandons is rebuilt here. `EventSource` retries a
 * dropped transport itself, but gives up for good when a reconnect is answered
 * with a non-200 or a wrong content type — leaving a `CLOSED` stream that would
 * otherwise never deliver another event, freezing every query behind it. The
 * rebuild backs off exponentially so a persistently failing endpoint isn't
 * hammered, and focusing the tab retries at once rather than waiting the
 * backoff out.
 *
 * `factory` and `reconnectBaseMs` are test seams; production callers omit both.
 */
export function LiveEventsProvider({
  children,
  factory = defaultFactory,
  reconnectBaseMs = RECONNECT_BASE_MS,
}: {
  children: ReactNode;
  factory?: EventSourceFactory;
  reconnectBaseMs?: number;
}) {
  const subscribersRef = useRef<Set<Subscriber>>(new Set());

  const subscribe = useCallback<LiveEventsContextValue["subscribe"]>((subscriber) => {
    subscribersRef.current.add(subscriber);
    return () => {
      subscribersRef.current.delete(subscriber);
    };
  }, []);

  useEffect(() => {
    let source: EventSourceLike | null = null;
    let handlers = new Map<KiriEventType, (event: MessageEvent) => void>();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let hasOpened = false;
    let wasAbandoned = false;
    let disposed = false;

    const detach = () => {
      if (!source) return;
      source.onopen = null;
      source.onerror = null;
      for (const [type, handler] of handlers) source.removeEventListener(type, handler);
      source.close();
      source = null;
      handlers = new Map();
    };

    const scheduleReconnect = () => {
      wasAbandoned = true;
      detach();
      const delay = Math.min(reconnectBaseMs * 2 ** attempt, RECONNECT_MAX_MS);
      attempt++;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    };

    function connect() {
      if (disposed) return;
      const stream = factory(eventsUrl());
      source = stream;

      stream.onopen = () => {
        attempt = 0;
        // Surfaces fetch on mount, so the page's first open needs no resync.
        // Every later open does — including the first open of a stream rebuilt
        // after the original was abandoned before it ever opened, since events
        // published in that gap were never delivered.
        const initial = !hasOpened && !wasAbandoned;
        hasOpened = true;
        if (initial) return;
        for (const sub of subscribersRef.current) sub.onReconnect?.();
      };

      // A dropped transport leaves the stream connecting and the browser retries
      // it unaided; only a `CLOSED` stream is one it has abandoned, and only that
      // needs rebuilding.
      stream.onerror = () => {
        if (disposed || stream.readyState !== CLOSED) return;
        scheduleReconnect();
      };

      for (const type of KIRI_EVENT_TYPES) {
        const handler = (event: MessageEvent) => {
          const parsed = JSON.parse(event.data) as KiriEvent;
          for (const sub of subscribersRef.current) {
            if (!sub.types.has(parsed.type)) continue;
            if (sub.filter && !sub.filter(parsed)) continue;
            sub.onEvent?.(parsed);
          }
        };
        stream.addEventListener(type, handler);
        handlers.set(type, handler);
      }
    }

    // Coming back to the tab, skip whatever is left of the backoff and retry at
    // once. A pending timer is the only sign the stream is down: an abandoned one
    // is detached, and a live or reconnecting stream has none. This checks the
    // transport rather than refetching on focus — the reconnect's own resync
    // does that, keeping the bus the single source of freshness.
    const reconnectNow = () => {
      if (disposed || retryTimer === null) return;
      clearTimeout(retryTimer);
      retryTimer = null;
      connect();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") reconnectNow();
    };

    connect();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", reconnectNow);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", reconnectNow);
      if (retryTimer !== null) clearTimeout(retryTimer);
      detach();
    };
  }, [factory, reconnectBaseMs]);

  return <LiveEventsContext.Provider value={{ subscribe }}>{children}</LiveEventsContext.Provider>;
}

/**
 * Subscribe a surface to the live events bus. `refetch` runs whenever an
 * event whose `type` is in `on` arrives (and passes `filter`, when given),
 * and whenever the underlying `EventSource` reconnects.
 *
 * Throws when used outside `<LiveEventsProvider>`.
 */
export function useLiveSync<T extends KiriEventType>(opts: {
  on: readonly T[];
  filter?: (event: Extract<KiriEvent, { type: T }>) => boolean;
  refetch: () => void;
}): void {
  const ctx = useContext(LiveEventsContext);
  if (!ctx) throw new Error("useLiveSync must be used inside <LiveEventsProvider>");

  const { on, filter, refetch } = opts;

  // Refs let the effect read the latest closures without re-subscribing.
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const filterRef = useRef(filter);
  filterRef.current = filter;

  // Stable key from the sorted type list so callers can pass a fresh
  // array literal on each render without churning the subscription.
  const key = [...on].sort().join("|");

  useEffect(() => {
    const types = new Set<KiriEventType>(key.split("|") as KiriEventType[]);
    const fire = () => refetchRef.current();
    return ctx.subscribe({
      types,
      filter: filterRef.current
        ? (event) => (filterRef.current as (event: KiriEvent) => boolean)(event)
        : undefined,
      onEvent: fire,
      onReconnect: fire,
    });
  }, [ctx, key]);
}

/**
 * Subscribe a side-effecting handler to live events. `handler` is called
 * with the typed payload for every dispatched event whose `type` is in
 * `on`. Reconnects do not replay handlers — pair with `useLiveSync` if a
 * surface also needs to recover state on (re)connect.
 *
 * Throws when used outside `<LiveEventsProvider>`.
 */
export function useLiveEvent<T extends KiriEventType>(opts: {
  on: readonly T[];
  handler: (event: Extract<KiriEvent, { type: T }>) => void;
}): void {
  const ctx = useContext(LiveEventsContext);
  if (!ctx) throw new Error("useLiveEvent must be used inside <LiveEventsProvider>");

  const { on, handler } = opts;

  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const key = [...on].sort().join("|");

  useEffect(() => {
    const types = new Set<KiriEventType>(key.split("|") as KiriEventType[]);
    return ctx.subscribe({
      types,
      filter: undefined,
      onEvent: (event) => (handlerRef.current as (event: KiriEvent) => void)(event),
      onReconnect: undefined,
    });
  }, [ctx, key]);
}

/**
 * Subscribe a handler that only fires on `EventSource` reconnects.
 * Useful for surfaces that handle live events with surgical state
 * updates (via `useLiveEvent`) but still need to reconcile state on
 * reconnect — recovering from events that may have been missed while
 * disconnected.
 *
 * Throws when used outside `<LiveEventsProvider>`.
 */
export function useLiveReconnect(onReconnect: () => void): void {
  const ctx = useContext(LiveEventsContext);
  if (!ctx) throw new Error("useLiveReconnect must be used inside <LiveEventsProvider>");

  const handlerRef = useRef(onReconnect);
  handlerRef.current = onReconnect;

  useEffect(() => {
    return ctx.subscribe({
      types: new Set(),
      filter: undefined,
      onEvent: undefined,
      onReconnect: () => handlerRef.current(),
    });
  }, [ctx]);
}
