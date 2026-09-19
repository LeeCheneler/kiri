import type { RunStatus, StepStatus } from "./runs.ts";
import type { SessionInboxItem, SessionStatus } from "./sessions.ts";

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
  | { type: "session.inbox.queued"; sessionId: string; source: SessionInboxItem["source"] }
  | { type: "session.inbox.delivered"; sessionId: string }
  | { type: "session.updated"; id: string; status: SessionStatus }
  | { type: "session.finished"; id: string; status: SessionStatus }
  | {
      type: "session.turn.settled";
      id: string;
      messageId: string | null;
      outcome: "ended" | "incomplete" | "failed" | "cancelled";
    }
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

/** Event names carried by the SSE stream. */
export type KiriEventType = KiriEvent["type"];

const eventNames = {
  "run.started": "run.started",
  "run.updated": "run.updated",
  "run.step.updated": "run.step.updated",
  "run.finished": "run.finished",
  "run.deleted": "run.deleted",
  "recommendation.actioned": "recommendation.actioned",
  "recommendation.updated": "recommendation.updated",
  "session.started": "session.started",
  "session.message.added": "session.message.added",
  "session.inbox.queued": "session.inbox.queued",
  "session.inbox.delivered": "session.inbox.delivered",
  "session.updated": "session.updated",
  "session.finished": "session.finished",
  "session.turn.settled": "session.turn.settled",
  "session.deleted": "session.deleted",
  "article.written": "article.written",
  "article.deleted": "article.deleted",
  "project.created": "project.created",
  "project.updated": "project.updated",
  "project.deleted": "project.deleted",
  "memory.saved": "memory.saved",
  "memory.deleted": "memory.deleted",
  "task.changed": "task.changed",
  "workflow.added": "workflow.added",
  "workflow.updated": "workflow.updated",
  "workflow.removed": "workflow.removed",
  "tool.permission.updated": "tool.permission.updated",
  "config.changed": "config.changed",
} satisfies { [Name in KiriEventType]: Name };

/** Complete event-name list for subscribing to the SSE stream. */
export const KIRI_EVENT_TYPES = Object.values(eventNames);
