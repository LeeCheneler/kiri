import type { ModelMessage, UIMessage } from "ai";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { type InboxUIPart, isInboxPart } from "../../shared/inbox-part.ts";
import type { KiriDb } from "../db/index.ts";
import { sessionInbox } from "../db/schema.ts";

/** A queued inbox row: a message waiting for its session's next step boundary. */
export type InboxItem = typeof sessionInbox.$inferSelect;

/** The delivered-part form of a queued item. */
export const inboxUIPart = (item: InboxItem): InboxUIPart => ({
  type: "data-inbox",
  id: item.id,
  data: { source: item.source, text: item.text, queuedAt: item.createdAt.getTime() },
});

/**
 * Queue a message for `sessionId`. It sits in the inbox until a turn drains
 * it — at the next step boundary of a running turn, or ahead of the next turn
 * when the session is idle.
 */
export function enqueueInboxItem(
  db: KiriDb,
  sessionId: string,
  item: { source: InboxItem["source"]; text: string },
): InboxItem {
  const id = crypto.randomUUID();
  db.insert(sessionInbox)
    .values({ id, sessionId, source: item.source, text: item.text, createdAt: new Date() })
    .run();
  return db.select().from(sessionInbox).where(eq(sessionInbox.id, id)).get() as InboxItem;
}

/** The session's undelivered backlog, oldest first. */
export function pendingInboxItems(db: KiriDb, sessionId: string): InboxItem[] {
  return (
    db
      .select()
      .from(sessionInbox)
      .where(eq(sessionInbox.sessionId, sessionId))
      // rowid breaks same-millisecond ties, keeping delivery strictly FIFO.
      .orderBy(asc(sessionInbox.createdAt), asc(sql`rowid`))
      .all()
  );
}

/**
 * Remove delivered rows. Called only once the delivery is persisted in the
 * transcript, so a turn that fails before persisting leaves its items queued
 * for redelivery rather than losing them.
 */
export function deleteInboxItems(db: KiriDb, ids: string[]): void {
  if (ids.length === 0) return;
  db.delete(sessionInbox).where(inArray(sessionInbox.id, ids)).run();
}

/**
 * One item's delivery into a running turn, recorded when `prepareStep` first
 * injects it. `insertIndex` — where the item slots into the step's model
 * messages — is in pre-injection space, so it stays valid as the turn grows:
 * the SDK rebuilds that array each step without our injections, so later
 * steps only ever append after recorded positions. The transcript position
 * needs no coordinate at all: the delivery is written into the turn's UI
 * stream at the boundary it happened, and the persisted message is assembled
 * from that same stream.
 */
export interface InboxDelivery {
  item: InboxItem;
  insertIndex: number;
}

// Framing wrapped around an item's text at send time, telling the model how
// the message reached it. Mid-turn: it interrupted work in progress. Queued:
// it waited for this turn to start.
const MID_TURN_FRAMING =
  "The user sent this message while you were working. Treat it as a course correction or " +
  "additional information for the task in progress: weigh it against the work you have already " +
  "done and carry on, rather than starting over or treating it as a fresh request.";
const QUEUED_FRAMING =
  "The user sent this message earlier, while no turn was running. It was queued and is " +
  "delivered now, ahead of the message that started this turn.";

const framed = (text: string, framing: string): string => `[${framing}]\n\n${text}`;

// The user-role model message an item is injected as mid-turn.
const midTurnModelMessage = (item: InboxItem): ModelMessage => ({
  role: "user",
  content: [{ type: "text", text: framed(item.text, MID_TURN_FRAMING) }],
});

/**
 * Insert each delivery's framed user message into a step's model messages at
 * its recorded position. `deliveries` is in delivery order, so positions are
 * non-decreasing and ties keep queue order. Positions are clamped to the end
 * defensively; with coordinates recorded from the SDK's own step input this
 * doesn't occur.
 */
export function insertInboxModelMessages(
  messages: ModelMessage[],
  deliveries: InboxDelivery[],
): ModelMessage[] {
  const out: ModelMessage[] = [];
  let next = 0;
  for (let i = 0; i <= messages.length; i += 1) {
    while (
      next < deliveries.length &&
      Math.min(deliveries[next].insertIndex, messages.length) === i
    ) {
      out.push(midTurnModelMessage(deliveries[next].item));
      next += 1;
    }
    if (i < messages.length) out.push(messages[i]);
  }
  return out;
}

// A split-off slice of an assistant message. Ids only need to be unique for
// the send — `convertToModelMessages` never reads them.
const assistantSlice = (
  message: UIMessage,
  parts: UIMessage["parts"],
  slice: number,
): UIMessage => ({ id: `${message.id}:${slice}`, role: "assistant", parts });

// The user-role message a woven inbox part expands back into.
const wovenUserMessage = (message: UIMessage, part: InboxUIPart): UIMessage => ({
  id: `${message.id}:inbox:${part.id}`,
  role: "user",
  parts: [{ type: "text", text: framed(part.data.text, MID_TURN_FRAMING) }],
});

/**
 * Expand delivered inbox parts back into the model-facing shape before
 * `convertToModelMessages`: a user message whose parts were drained from the
 * inbox becomes plain framed text, and an assistant message with woven
 * deliveries splits into assistant slices with a framed user message between —
 * the same sequence the live turn saw, so later turns replay history
 * faithfully. Splits only ever fall on step boundaries, so a slice always
 * keeps its tool calls and results together. Messages without inbox parts pass
 * through untouched.
 */
export function expandInboxMessages(messages: UIMessage[]): UIMessage[] {
  return messages.flatMap((message) => {
    if (!message.parts.some(isInboxPart)) return [message];
    if (message.role !== "assistant") {
      return [
        {
          ...message,
          parts: message.parts.map((part) =>
            isInboxPart(part)
              ? ({ type: "text", text: framed(part.data.text, QUEUED_FRAMING) } as const)
              : part,
          ),
        },
      ];
    }
    const expanded: UIMessage[] = [];
    let slice: UIMessage["parts"] = [];
    let sliceIndex = 0;
    for (const part of message.parts) {
      if (isInboxPart(part)) {
        if (slice.length > 0) {
          expanded.push(assistantSlice(message, slice, sliceIndex));
          sliceIndex += 1;
          slice = [];
        }
        expanded.push(wovenUserMessage(message, part));
      } else {
        slice.push(part);
      }
    }
    if (slice.length > 0) expanded.push(assistantSlice(message, slice, sliceIndex));
    return expanded;
  });
}
