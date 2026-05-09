import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { EventBus } from "./bus.ts";

const DEFAULT_HEARTBEAT_MS = 15_000;

export interface MountEventsRouteOptions {
  bus: EventBus;
  /** Heartbeat (`: keep-alive`) cadence in ms. Defaults to 15s. */
  heartbeatMs?: number;
}

/**
 * Mount `GET /api/events` on `app`. The endpoint subscribes to the bus
 * and streams every event as `event: <type>\ndata: <json>` SSE frames.
 * A `: keep-alive` comment is emitted on `heartbeatMs` cadence so idle
 * intermediaries don't close the connection. The subscription and
 * heartbeat are released when the client disconnects.
 *
 * Read-only by design: no `X-Kiri-Client` header is required and none
 * could be sent — `EventSource` cannot set custom headers.
 */
export function mountEventsRoute(app: Hono, opts: MountEventsRouteOptions): void {
  const { bus, heartbeatMs = DEFAULT_HEARTBEAT_MS } = opts;
  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      const unsubscribe = bus.subscribe((event) => {
        void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      });
      const heartbeat = setInterval(() => {
        void stream.write(": keep-alive\n\n");
      }, heartbeatMs);
      try {
        await new Promise<void>((resolve) => {
          stream.onAbort(() => resolve());
        });
      } finally {
        clearInterval(heartbeat);
        unsubscribe();
      }
    }),
  );
}
