import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef } from "react";

/** All event types pushed by the server's in-process bus over `/api/events`. */
export type KiriEventType =
  | "run.started"
  | "run.updated"
  | "run.step.updated"
  | "run.finished"
  | "workflow.added"
  | "workflow.updated"
  | "workflow.removed";

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
  | {
      type: "run.finished";
      id: string;
      status: "running" | "ok" | "failed" | "cancelled";
      workflowName: string;
    }
  | { type: "workflow.added"; name: string }
  | { type: "workflow.updated"; name: string }
  | { type: "workflow.removed"; name: string };

/** Minimal `EventSource` surface so tests can swap in a controllable fake. */
export interface EventSourceLike {
  addEventListener(type: string, handler: (event: MessageEvent) => void): void;
  removeEventListener(type: string, handler: (event: MessageEvent) => void): void;
  close(): void;
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
  "workflow.added",
  "workflow.updated",
  "workflow.removed",
];

const KIRI_ORIGIN = "http://127.0.0.1:4242";

const eventsUrl = (): string => {
  const localhost =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  return `${localhost ? "" : KIRI_ORIGIN}/api/events`;
};

const defaultFactory: EventSourceFactory = (url) => new EventSource(url);

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
 * events out to subscribers registered via `useLiveSync`. On every reconnect
 * (open after the first), every subscriber's `refetch` fires so the UI
 * recovers from any events missed while disconnected. The initial open is
 * intentionally silent — surfaces fetch on mount.
 *
 * `factory` is a test seam; production callers omit it and get the native
 * `EventSource`.
 */
export function LiveEventsProvider({
  children,
  factory = defaultFactory,
}: {
  children: ReactNode;
  factory?: EventSourceFactory;
}) {
  const subscribersRef = useRef<Set<Subscriber>>(new Set());

  const subscribe = useCallback<LiveEventsContextValue["subscribe"]>((subscriber) => {
    subscribersRef.current.add(subscriber);
    return () => {
      subscribersRef.current.delete(subscriber);
    };
  }, []);

  useEffect(() => {
    const source = factory(eventsUrl());
    let openCount = 0;

    source.onopen = () => {
      openCount++;
      if (openCount === 1) return;
      for (const sub of subscribersRef.current) sub.onReconnect?.();
    };

    const handlers = new Map<KiriEventType, (event: MessageEvent) => void>();
    for (const type of KIRI_EVENT_TYPES) {
      const handler = (event: MessageEvent) => {
        const parsed = JSON.parse(event.data) as KiriEvent;
        for (const sub of subscribersRef.current) {
          if (!sub.types.has(parsed.type)) continue;
          if (sub.filter && !sub.filter(parsed)) continue;
          sub.onEvent?.(parsed);
        }
      };
      source.addEventListener(type, handler);
      handlers.set(type, handler);
    }

    return () => {
      source.onopen = null;
      for (const [type, handler] of handlers) source.removeEventListener(type, handler);
      source.close();
    };
  }, [factory]);

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
