import type { UIMessage } from "ai";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { KiriDb } from "../db/index.ts";
import { messages, sessions } from "../db/schema.ts";
import type { SessionStatus } from "../events/index.ts";
import type { LlmUsage } from "../llm/index.ts";

/** A persisted session row. */
export type Session = typeof sessions.$inferSelect;
/** A persisted message row. `parts` is an AI SDK `UIMessage` parts array (typed `unknown` by drizzle's JSON column). */
export type Message = typeof messages.$inferSelect;

/** A message to append, ahead of being assigned its row id, index, and timestamp. */
export interface NewMessage {
  role: "user" | "assistant" | "system";
  parts: UIMessage["parts"];
  /** Token usage for the turn that produced this message; omitted for user messages. */
  usage?: LlmUsage;
}

/**
 * Insert a new session against `model` (a `provider:model` id), starting it
 * `idle` with zero token totals. Returns the persisted row.
 */
export function createSession(
  db: KiriDb,
  model: string,
  opts: { id?: string; startedAt?: Date } = {},
): Session {
  const id = opts.id ?? crypto.randomUUID();
  db.insert(sessions)
    .values({
      id,
      status: "idle",
      model,
      startedAt: opts.startedAt ?? new Date(),
    })
    .run();
  return getSession(db, id) as Session;
}

/** Read a session by id, or `undefined` if none exists. */
export function getSession(db: KiriDb, id: string): Session | undefined {
  return db.select().from(sessions).where(eq(sessions.id, id)).get();
}

/**
 * Set the `provider:model` id a session's turns run against. The turn endpoint
 * resolves the model per turn, so the change takes effect from the next turn.
 * Returns the updated row.
 */
export function updateSessionModel(db: KiriDb, id: string, model: string): Session {
  db.update(sessions).set({ model }).where(eq(sessions.id, id)).run();
  return getSession(db, id) as Session;
}

/** Length cap for a session's preview label. */
const PREVIEW_LENGTH = 100;

// A message's text parts, joined and tidied into a single capped line — a
// human-readable label drawn from what the user typed.
function messagePreview(parts: UIMessage["parts"]): string {
  return parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PREVIEW_LENGTH);
}

/**
 * Preview label for each of `sessionIds`, taken from its first user message
 * (whitespace collapsed, capped at 100 chars). A single batched query, ordered
 * so the lowest-index user message per session wins. Sessions without a user
 * message yet — or whose first one has no text — are absent from the map.
 */
export function getSessionPreviews(db: KiriDb, sessionIds: string[]): Map<string, string> {
  const previews = new Map<string, string>();
  if (sessionIds.length === 0) return previews;
  const rows = db
    .select({ sessionId: messages.sessionId, parts: messages.parts })
    .from(messages)
    .where(and(inArray(messages.sessionId, sessionIds), eq(messages.role, "user")))
    .orderBy(asc(messages.index))
    .all();
  for (const row of rows) {
    if (previews.has(row.sessionId)) continue;
    const text = messagePreview(row.parts as UIMessage["parts"]);
    if (text !== "") previews.set(row.sessionId, text);
  }
  return previews;
}

/** Read a session's messages in order. */
export function getSessionMessages(db: KiriDb, sessionId: string): Message[] {
  return db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.index))
    .all();
}

/**
 * Append `message` to a session at the next index. Messages are only ever
 * appended, so the current count is the next index. Returns the persisted row.
 */
export function appendMessage(
  db: KiriDb,
  sessionId: string,
  message: NewMessage,
  opts: { id?: string; createdAt?: Date } = {},
): Message {
  const index = db
    .select({ index: messages.index })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .all().length;
  const id = opts.id ?? crypto.randomUUID();
  db.insert(messages)
    .values({
      id,
      sessionId,
      index,
      role: message.role,
      parts: message.parts,
      usage: message.usage ?? null,
      createdAt: opts.createdAt ?? new Date(),
    })
    .run();
  return db.select().from(messages).where(eq(messages.id, id)).get() as Message;
}

/**
 * Add a completed turn's token usage to a session's running totals. A count
 * the provider omitted contributes nothing to its column. Increments in SQL so
 * the read-modify-write is atomic.
 */
export function addTurnUsage(db: KiriDb, sessionId: string, usage: LlmUsage): void {
  db.update(sessions)
    .set({
      inputTokens: sql`${sessions.inputTokens} + ${usage.inputTokens ?? 0}`,
      outputTokens: sql`${sessions.outputTokens} + ${usage.outputTokens ?? 0}`,
      totalTokens: sql`${sessions.totalTokens} + ${usage.totalTokens ?? 0}`,
    })
    .where(eq(sessions.id, sessionId))
    .run();
}

/**
 * Move a session to `status`. Pass `error` and/or `finishedAt` to set them in
 * the same write (a terminal `failed`/`cancelled` carries both); omit them to
 * leave the existing values untouched.
 */
export function setSessionStatus(
  db: KiriDb,
  sessionId: string,
  status: SessionStatus,
  update: { error?: unknown; finishedAt?: Date | null } = {},
): void {
  db.update(sessions)
    .set({
      status,
      ...("error" in update ? { error: update.error } : {}),
      ...("finishedAt" in update ? { finishedAt: update.finishedAt } : {}),
    })
    .where(eq(sessions.id, sessionId))
    .run();
}

/**
 * Permanently delete a session and its messages in one transaction. Messages
 * hold an FK to the session, so they go first — an in-code cascade matching the
 * rest of the codebase rather than a schema-level ON DELETE. Deleting an absent
 * session removes nothing.
 */
export function deleteSession(db: KiriDb, id: string): void {
  db.transaction((tx) => {
    tx.delete(messages).where(eq(messages.sessionId, id)).run();
    tx.delete(sessions).where(eq(sessions.id, id)).run();
  });
}
