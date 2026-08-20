import { createLogger } from "../log.ts";

const log = createLogger("events");
/**
 * Discriminated union of every event the in-process bus carries. Consumers
 * narrow on `type` to get a typed payload. Payloads stay thin — an ID plus,
 * where relevant, a status; consumers refetch the affected resource for
 * anything richer.
 */
export type KiriEvent =
  | { type: "run.started"; id: string }
  | { type: "run.updated"; id: string; status: RunStatus }
  | { type: "run.step.updated"; runId: string; step: number; status: StepStatus }
  | { type: "run.finished"; id: string; status: RunStatus }
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
      status: RunStatus;
    }
  | { type: "session.started"; id: string }
  | { type: "session.message.added"; sessionId: string }
  | { type: "session.updated"; id: string; status: SessionStatus }
  | { type: "session.finished"; id: string; status: SessionStatus }
  | { type: "session.deleted"; id: string }
  | { type: "article.written"; sessionId: string; slug: string; projectId?: string }
  | { type: "article.deleted"; slug: string; sessionId?: string; projectId?: string }
  | { type: "project.created"; id: string }
  | { type: "project.updated"; id: string }
  | { type: "project.deleted"; id: string }
  | { type: "memory.saved"; name: string; projectId?: string }
  | { type: "memory.deleted"; name: string; projectId?: string }
  | { type: "task.changed"; projectId: string }
  | { type: "workflow.added"; name: string }
  | { type: "workflow.updated"; name: string }
  | { type: "workflow.removed"; name: string }
  | { type: "tool.permission.updated"; tool: string }
  | { type: "config.changed" };

export type RunStatus = "running" | "ok" | "failed" | "cancelled";
export type StepStatus = "running" | "ok" | "failed" | "cancelled";
/**
 * Session lifecycle states. `idle` replaces a run's terminal `ok`: a session
 * returns to it between turns rather than ending. `waiting` is a turn paused on
 * tool-approval requests — blocked on the user's verdicts rather than resting.
 */
export type SessionStatus = "running" | "waiting" | "idle" | "failed" | "cancelled";

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
