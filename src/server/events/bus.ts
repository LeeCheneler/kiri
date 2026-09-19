import type { KiriEvent } from "../../shared/api/events.ts";
import { createLogger } from "../log.ts";

const log = createLogger("events");
export type { KiriEvent } from "../../shared/api/events.ts";
export type { RunStatus, StepStatus } from "../../shared/api/runs.ts";
export type { SessionStatus } from "../../shared/api/sessions.ts";

export type EventListener = (event: KiriEvent) => void;

export interface EventBus {
  /** Synchronously deliver `event` to every current subscriber. */
  publish(event: KiriEvent): void;
  /** Register `listener` and return a function that unsubscribes it. Calling the returned function more than once is a no-op. */
  subscribe(listener: EventListener): () => void;
}

/**
 * Create an in-memory event bus. Synchronous delivery, no buffering, no
 * replay. Multiple subscribers supported; a subscriber that throws is
 * logged and isolated so later subscribers still receive the event.
 * Unsubscribing during dispatch is safe — each `publish` snapshots the
 * subscriber set before iterating.
 */
export function createEventBus(): EventBus {
  const listeners = new Set<EventListener>();
  return {
    publish(event) {
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch (cause) {
          log.error(
            `listener threw on ${event.type}: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
