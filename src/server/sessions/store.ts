import type { UIMessage } from "ai";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import type { KiriDb } from "../db/index.ts";
import { articles, messages, sessions } from "../db/schema.ts";
import type { SessionStatus } from "../events/index.ts";

/** A persisted session row. */
export type Session = typeof sessions.$inferSelect;
/** A persisted message row. `parts` is an AI SDK `UIMessage` parts array (typed `unknown` by drizzle's JSON column). */
export type Message = typeof messages.$inferSelect;

/** A message to append, ahead of being assigned its row id, index, and timestamp. */
export interface NewMessage {
  role: "user" | "assistant" | "system";
  parts: UIMessage["parts"];
  /** Context footprint for the turn that produced this message; omitted for user messages. */
  contextTokens?: number;
}

/**
 * Insert a new session against `model` (a `provider:model` id), starting it
 * `idle`. Pass `imageModel` to start with image generation on; it stays
 * swappable via `updateSessionImageModel`. Pass `parentSessionId` (with the
 * spawning `parentToolCallId`) to create a child session; omit them for a
 * top-level one. Returns the persisted row.
 */
export function createSession(
  db: KiriDb,
  model: string,
  opts: {
    id?: string;
    startedAt?: Date;
    imageModel?: string;
    parentSessionId?: string;
    parentToolCallId?: string;
  } = {},
): Session {
  const id = opts.id ?? crypto.randomUUID();
  db.insert(sessions)
    .values({
      id,
      status: "idle",
      model,
      imageModel: opts.imageModel ?? null,
      startedAt: opts.startedAt ?? new Date(),
      parentSessionId: opts.parentSessionId ?? null,
      parentToolCallId: opts.parentToolCallId ?? null,
    })
    .run();
  return getSession(db, id) as Session;
}

/** Read a session by id, or `undefined` if none exists. */
export function getSession(db: KiriDb, id: string): Session | undefined {
  return db.select().from(sessions).where(eq(sessions.id, id)).get();
}

/**
 * Find the child session spawned from a parent's specific tool call, or
 * `undefined` if none exists yet. Lets a parent's tool-call block re-attach its
 * running child after a reload, and makes child creation idempotent for one call.
 */
export function findChildByToolCall(
  db: KiriDb,
  parentSessionId: string,
  parentToolCallId: string,
): Session | undefined {
  return db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.parentSessionId, parentSessionId),
        eq(sessions.parentToolCallId, parentToolCallId),
      ),
    )
    .get();
}

/**
 * List a session's child sessions oldest-first — one per delegate call its
 * turns have spawned. A session with no children yields an empty list.
 */
export function getSessionChildren(db: KiriDb, parentSessionId: string): Session[] {
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.parentSessionId, parentSessionId))
    .orderBy(asc(sessions.startedAt), asc(sessions.id))
    .all();
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

/**
 * Set the `provider:model` id the session generates images with, or pass
 * `null` to turn image generation off. Resolved when an image is generated,
 * so the change applies to the next generation. Returns the updated row.
 */
export function updateSessionImageModel(
  db: KiriDb,
  id: string,
  imageModel: string | null,
): Session {
  db.update(sessions).set({ imageModel }).where(eq(sessions.id, id)).run();
  return getSession(db, id) as Session;
}

/**
 * Pin or unpin a session. A display flag only — pinned sessions surface on the
 * feed's Pinned tab; execution is unaffected. Returns the updated row.
 */
export function setSessionPinned(db: KiriDb, id: string, pinned: boolean): Session {
  db.update(sessions).set({ pinned }).where(eq(sessions.id, id)).run();
  return getSession(db, id) as Session;
}

/** Length cap for a session's preview label. */
const PREVIEW_LENGTH = 100;

// A message's text parts, joined and tidied into a single capped line — a
// human-readable label drawn from what the user typed. A capped line ends in an
// ellipsis so it reads as truncated rather than as if the user stopped mid-word.
function messagePreview(parts: UIMessage["parts"]): string {
  const text = parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH).trimEnd()}…` : text;
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
      contextTokens: message.contextTokens ?? null,
      createdAt: opts.createdAt ?? new Date(),
    })
    .run();
  return db.select().from(messages).where(eq(messages.id, id)).get() as Message;
}

/**
 * Replace a message's `parts`, optionally recording its context footprint.
 * Drives the two writes of a tool-approval resume: first the pending assistant
 * message is patched with the user's verdicts (parts only, footprint left as
 * is), then the streamed continuation extends it in place and records the
 * resumed turn's footprint — a high-water mark, so the latest value stands.
 */
export function updateMessage(
  db: KiriDb,
  sessionId: string,
  messageId: string,
  update: { parts: UIMessage["parts"]; contextTokens?: number },
): void {
  db.update(messages)
    .set({
      parts: update.parts,
      ...("contextTokens" in update ? { contextTokens: update.contextTokens ?? null } : {}),
    })
    .where(and(eq(messages.sessionId, sessionId), eq(messages.id, messageId)))
    .run();
}

/**
 * Delete the message `messageId` and every message after it in the session.
 * Rolls a transcript back to an earlier point — e.g. editing and resending a
 * user message, which discards that message and the turns that followed.
 * Trailing rows are removed wholesale rather than gapped, so the append-at-count
 * invariant in `appendMessage` still holds. Returns whether the message existed;
 * truncating from an absent message changes nothing.
 */
export function deleteMessagesFrom(db: KiriDb, sessionId: string, messageId: string): boolean {
  const target = db
    .select({ index: messages.index })
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), eq(messages.id, messageId)))
    .get();
  if (!target) return false;
  db.delete(messages)
    .where(and(eq(messages.sessionId, sessionId), gte(messages.index, target.index)))
    .run();
  return true;
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
 * Permanently delete a session — and any child sessions it spawned — with
 * their messages and articles in one transaction. Messages and articles hold
 * an FK to the session, so they go first — an in-code cascade matching the
 * rest of the codebase rather than a schema-level ON DELETE. Children never
 * have children of their own, so one level of cascade is complete. Deleting
 * an absent session removes nothing.
 */
export function deleteSession(db: KiriDb, id: string): void {
  db.transaction((tx) => {
    const childIds = tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.parentSessionId, id))
      .all()
      .map((row) => row.id);
    const ids = [...childIds, id];
    tx.delete(articles).where(inArray(articles.sessionId, ids)).run();
    tx.delete(messages).where(inArray(messages.sessionId, ids)).run();
    // Children first: they hold an FK to the parent, and foreign_keys is ON.
    if (childIds.length > 0) tx.delete(sessions).where(inArray(sessions.id, childIds)).run();
    tx.delete(sessions).where(eq(sessions.id, id)).run();
  });
}
