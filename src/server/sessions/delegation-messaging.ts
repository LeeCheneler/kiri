import { type UIMessage, isToolUIPart } from "ai";
import type { KiriDb } from "../db/index.ts";
import type { EventBus, KiriEvent } from "../events/index.ts";
import { createLogger } from "../log.ts";
import { type InboxTrigger, inboxDelivery, queuedBy } from "./inbox-delivery.ts";
import { enqueueInboxItem, sessionsWithBacklog } from "./inbox.ts";
import { type Session, getSession, getSessionMessages } from "./store.ts";
import { ShuttingDownError, TurnInFlightError } from "./turn-lifecycle.ts";
import type { StartTurn } from "./turn-start.ts";

const log = createLogger("sessions");

export interface DelegationMessagingDeps {
  db: KiriDb;
  bus: EventBus;
  /**
   * Starts a turn for any session — a delegated child against the worker
   * catalogue, a top-level session against the full one — so a wake runs
   * whichever side of a delegation the message landed on, prepared as a turn
   * started by the user is.
   */
  startTurn: StartTurn;
}

type TurnSettlement = Extract<KiriEvent, { type: "session.turn.settled" }>;

const SETTLEMENT_NOTICE: Record<TurnSettlement["outcome"], string> = {
  ended: "Automatic notice: this worker's turn ended.",
  incomplete:
    "Automatic notice: this worker stopped at a work or context limit; work may be incomplete.",
  failed: "Automatic notice: this worker's turn failed and it has stopped.",
  cancelled:
    "Automatic notice: this worker was cancelled by the user and has stopped. It will not restart on its own.",
};
const MAX_SETTLEMENT_LENGTH = 8_000;

// Only the saved reply after the last tool call is a fallback report. Earlier
// prose may be work in progress, and a successful message_parent call already
// delivered its input through the inbox. Neither proves the task is complete.
function settlementText(db: KiriDb, child: Session, event: TurnSettlement): string {
  const message = getSessionMessages(db, child.id).find((row) => row.id === event.messageId);
  const parts = (message?.parts ?? []) as UIMessage["parts"];
  const finalText = parts
    .slice(parts.findLastIndex(isToolUIPart) + 1)
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
  const alreadySent = parts.some((part) => {
    if (part.type !== "tool-message_parent" || part.state !== "output-available") return false;
    const input = part.input as { message?: unknown } | undefined;
    return typeof input?.message === "string" && input.message.trim() === finalText;
  });
  const error = (child.error as { message?: string } | null)?.message;
  const header = [
    SETTLEMENT_NOTICE[event.outcome],
    "A stopped turn or an earlier progress message does not establish task completion. Check the result and what remains.",
    ...(event.outcome === "failed" && error ? [`Error: ${error.slice(0, 500)}`] : []),
    `Worker transcript: /sessions/${child.id}${event.messageId ? ` (message ${event.messageId})` : ""}.`,
  ].join("\n\n");
  if (!finalText)
    return `${header}\n\nNo final reply was saved. Review earlier messages and the worker transcript for its progress and any outstanding work.`;
  if (alreadySent)
    return `${header}\n\nThe final reply was already delivered through message_parent; its body is not repeated here.`;

  const prefix = `${header}\n\nSaved worker reply (may be partial):\n`;
  const suffix = "\n[Excerpt truncated; see the worker transcript.]";
  const remaining = MAX_SETTLEMENT_LENGTH - prefix.length;
  return finalText.length <= remaining
    ? prefix + finalText
    : prefix + finalText.slice(0, remaining - suffix.length) + suffix;
}

/**
 * The messaging loop that lets delegations run as plain sessions talking
 * through their inboxes. One bus subscription carries the whole behaviour:
 *
 * - A message enqueued to a session that is out of a turn starts one — a wake
 *   turn opening with the drained backlog. (A busy session's messages weave
 *   in at its next step boundary; a `waiting` session's deliver when the user
 *   resolves its approvals — a wake never bypasses one.)
 * - A session that settles idle with messages still queued gets its wake turn
 *   straight away: a message that arrives after a running turn's last step
 *   boundary misses both the weave and the enqueue-time wake, and would
 *   otherwise sit until something else stirred the session. A turn that
 *   settles `failed` deliberately does not re-wake — its own delivery
 *   attempt failing would loop — so a failed session waits for the next
 *   message (or the user) to try again.
 * - Mounting wakes the idle sessions already holding a backlog: one queued
 *   just before the app last stopped, which no later event would deliver.
 * - Every settled worker turn enqueues a runtime notice to its parent, even
 *   when the worker omitted message_parent. A saved final reply is included
 *   within a size limit unless it was already delivered. Approval pauses are
 *   not settlements, and a settlement does not claim the task is complete.
 *
 * Returns the unsubscribe function. Wake turns run detached: failures land on
 * the session's own status through the turn machinery, and are logged here.
 */
export function mountDelegationMessaging(deps: DelegationMessagingDeps): () => void {
  const { db, bus, startTurn } = deps;

  const wake = async (sessionId: string, trigger: InboxTrigger) => {
    const session = getSession(db, sessionId);
    if (!session || inboxDelivery(session.status, trigger) !== "wake") return;
    // A wake start runs synchronously up to marking the session `running`
    // (or resolves null on an already-drained backlog — the wake raced an
    // earlier drain), so a second queued event on the same tick finds it
    // unwakeable rather than racing a concurrent turn.
    try {
      const started = await startTurn(session, { kind: "wake" });
      await started?.done;
    } catch (cause) {
      // Losing the session to another turn is no failure: that turn weaves
      // the backlog in, or its idle settle wakes the session again.
      if (cause instanceof TurnInFlightError) return;
      // The backlog stays queued, and the next start wakes the session for it.
      if (cause instanceof ShuttingDownError) return;
      // The start has already settled the session as failed (for example, the
      // worker's model no longer resolves), which notices its parent below.
      log.error(`wake turn for session ${sessionId} failed`, cause);
    }
  };

  const notifyParent = (child: Session, event: TurnSettlement) => {
    if (child.parentSessionId === null) return;
    enqueueInboxItem(db, child.parentSessionId, {
      source: "child",
      fromSessionId: child.id,
      text: settlementText(db, child, event),
    });
    // Publishing the queued event hands delivery to the same loop: the
    // notice weaves into a busy parent or wakes an idle one.
    bus.publish({
      type: "session.inbox.queued",
      sessionId: child.parentSessionId,
      source: "child",
    });
  };

  const unsubscribe = bus.subscribe((event) => {
    if (event.type === "session.inbox.queued") void wake(event.sessionId, queuedBy(event.source));
    if (event.type === "session.updated" && event.status === "idle") void wake(event.id, "settled");
    if (event.type === "session.turn.settled") {
      const session = getSession(db, event.id);
      if (session) notifyParent(session, event);
    }
  });
  // A message queued just before the app last stopped never got its wake;
  // nothing else would stir its session now.
  for (const sessionId of sessionsWithBacklog(db)) void wake(sessionId, "startup");
  return unsubscribe;
}
