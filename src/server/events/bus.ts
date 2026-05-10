/**
 * Discriminated union of every event the in-process bus carries. Consumers
 * narrow on `type` to get a typed payload. Payloads stay thin (IDs +
 * status); the single relaxation is `run.finished` which carries
 * `workflowName` so completion toasts can render without a refetch.
 */
export type KiriEvent =
  | { type: "run.started"; id: string }
  | { type: "run.updated"; id: string; status: RunStatus }
  | { type: "run.step.updated"; runId: string; step: number; status: StepStatus }
  | { type: "run.finished"; id: string; status: RunStatus; workflowName: string }
  | { type: "workflow.added"; name: string }
  | { type: "workflow.updated"; name: string }
  | { type: "workflow.removed"; name: string };

export type RunStatus = "running" | "ok" | "failed" | "cancelled";
export type StepStatus = "running" | "ok" | "failed" | "cancelled";

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
          console.error(
            `events: listener threw on ${event.type}: ${cause instanceof Error ? cause.message : String(cause)}`,
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
