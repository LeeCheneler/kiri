import type { UIMessage } from "ai";
import { and, asc, count, desc, eq, gte, inArray, isNull, max, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { SessionOwners } from "../../shared/api/events.ts";
import { type ArticleSummary, articleSummariesByOwner } from "../articles/store.ts";
import type { KiriDb } from "../db/index.ts";
import { articles, messages, projects, sessionInbox, sessions } from "../db/schema.ts";
import type { SessionStatus } from "../events/index.ts";
import { CURRENT_PARTS_FORMAT, readStoredParts } from "./transcript-format.ts";

/** A persisted session row. */
export type Session = typeof sessions.$inferSelect;
/**
 * A persisted message. `parts` is an AI SDK `UIMessage` parts array in the
 * current parts format, whichever format its row was written in.
 */
export type Message = Omit<typeof messages.$inferSelect, "partsFormat">;

const toMessage = ({ partsFormat, ...row }: typeof messages.$inferSelect): Message => ({
  ...row,
  parts: readStoredParts(row.id, partsFormat, row.parts),
});

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
 * swappable via `updateSessionImageModel`. Pass `effort` to start at a level
 * other than the `medium` default. Pass `title` to name the session from the
 * start; it stays editable via `updateSessionTitle`. Pass `cwd` to start the
 * session working from that directory; it stays movable via
 * `updateSessionCwd`. Pass `projectId` to create the session within a
 * project. Standalone sessions can later move into a project with their
 * articles. Pass `parentSessionId`
 * (with the spawning `parentToolCallId`) to create a child session; omit them
 * for a top-level one. Returns the persisted row.
 */
export function createSession(
  db: KiriDb,
  model: string,
  opts: {
    id?: string;
    startedAt?: Date;
    imageModel?: string;
    effort?: Session["effort"];
    title?: string;
    cwd?: string;
    projectId?: string;
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
      title: opts.title ?? null,
      cwd: opts.cwd ?? null,
      projectId: opts.projectId ?? null,
      ...(opts.effort !== undefined ? { effort: opts.effort } : {}),
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
 * Apply validated settings to an existing session in one atomic update and
 * return its row. Undefined fields are unchanged; an empty patch only reads.
 */
export function updateSessionSettings(
  db: KiriDb,
  id: string,
  settings: Partial<Pick<Session, "model" | "imageModel" | "effort" | "title">>,
): Session {
  if (Object.values(settings).every((value) => value === undefined)) {
    return getSession(db, id) as Session;
  }
  return db.update(sessions).set(settings).where(eq(sessions.id, id)).returning().get() as Session;
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
 * Set the effort level the session's turns run at. Applied when a turn maps
 * it to provider reasoning parameters, so the change takes effect from the
 * next turn. Returns the updated row.
 */
export function updateSessionEffort(db: KiriDb, id: string, effort: Session["effort"]): Session {
  db.update(sessions).set({ effort }).where(eq(sessions.id, id)).run();
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
 * Set the session's display name, or pass `null` to clear it back to the
 * untitled fallback. A display field only — the session list, activity feed,
 * and search results lead with it; execution is unaffected. Returns the
 * updated row.
 */
export function updateSessionTitle(db: KiriDb, id: string, title: string | null): Session {
  db.update(sessions).set({ title }).where(eq(sessions.id, id)).run();
  return getSession(db, id) as Session;
}

/**
 * Set the absolute directory the session works from — relative filesystem-tool
 * paths resolve against it and shell commands run in it by default. Callers
 * validate the directory against the sandbox before writing; this is the bare
 * persistence step. Returns the updated row.
 */
export function updateSessionCwd(db: KiriDb, id: string, cwd: string | null): Session {
  db.update(sessions).set({ cwd }).where(eq(sessions.id, id)).run();
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
 * Preview label for each untitled session in `sessionIds`, taken from its
 * first user message (whitespace collapsed, capped at 100 chars). A titled
 * session is named by its title wherever it is listed, so it is never read. A
 * single batched query that reads one message per session, however long the
 * history behind it. Sessions without a user message yet — or whose first one
 * has no text — are absent from the map.
 */
export function getSessionPreviews(db: KiriDb, sessionIds: string[]): Map<string, string> {
  const previews = new Map<string, string>();
  if (sessionIds.length === 0) return previews;

  const candidate = alias(messages, "candidate");
  const firstUserMessageId = db
    .select({ id: candidate.id })
    .from(candidate)
    .where(and(eq(candidate.sessionId, sessions.id), eq(candidate.role, "user")))
    .orderBy(asc(candidate.index))
    .limit(1);
  const rows = db
    .select({
      id: messages.id,
      sessionId: messages.sessionId,
      parts: messages.parts,
      partsFormat: messages.partsFormat,
    })
    .from(sessions)
    .innerJoin(messages, eq(messages.id, sql`(${firstUserMessageId})`))
    .where(and(inArray(sessions.id, sessionIds), isNull(sessions.title)))
    .all();

  for (const row of rows) {
    const text = messagePreview(readStoredParts(row.id, row.partsFormat, row.parts));
    if (text !== "") previews.set(row.sessionId, text);
  }

  return previews;
}

/**
 * Display label for each of `sessionIds` — how a session is named wherever it
 * is listed rather than read: its title, else its opening message, else its
 * short id. Every session in `sessionIds` gets an entry, so a caller never has
 * to invent a fallback; ids naming no session are absent.
 */
export function getSessionLabels(db: KiriDb, sessionIds: string[]): Map<string, string> {
  const labels = new Map<string, string>();
  if (sessionIds.length === 0) return labels;
  const rows = db
    .select({ id: sessions.id, title: sessions.title })
    .from(sessions)
    .where(inArray(sessions.id, sessionIds))
    .all();
  const previews = getSessionPreviews(
    db,
    rows.map((row) => row.id),
  );
  for (const { id, title } of rows) {
    labels.set(id, title ?? previews.get(id) ?? id.slice(0, 8));
  }
  return labels;
}

/**
 * When each of `sessionIds` last moved: its last message's timestamp. Messages
 * are only ever appended, so the highest index is the newest. A single batched
 * query that reads one row per session. Sessions with no messages yet are
 * absent from the map — callers fall back to `startedAt`.
 */
export function getSessionLastActivity(db: KiriDb, sessionIds: string[]): Map<string, Date> {
  if (sessionIds.length === 0) return new Map();

  const candidate = alias(messages, "candidate");
  const lastIndex = db
    .select({ index: max(candidate.index) })
    .from(candidate)
    .where(eq(candidate.sessionId, sessions.id));
  const rows = db
    .select({ sessionId: messages.sessionId, createdAt: messages.createdAt })
    .from(sessions)
    .innerJoin(
      messages,
      and(eq(messages.sessionId, sessions.id), eq(messages.index, sql`(${lastIndex})`)),
    )
    .where(inArray(sessions.id, sessionIds))
    .all();

  return new Map(rows.map((row) => [row.sessionId, row.createdAt]));
}

/**
 * Which of `sessionIds` have a delegated child paused waiting on tool
 * approval — blocked on the user, so listings can badge the session. A single
 * batched query; sessions with no waiting child are absent from the set.
 */
export function getSessionsWithWaitingChildren(db: KiriDb, sessionIds: string[]): Set<string> {
  if (sessionIds.length === 0) return new Set();
  return new Set(
    db
      .select({ parentSessionId: sessions.parentSessionId })
      .from(sessions)
      .where(and(inArray(sessions.parentSessionId, sessionIds), eq(sessions.status, "waiting")))
      .all()
      .flatMap((row) => row.parentSessionId ?? []),
  );
}

/**
 * A session row enriched for a listing: the row plus its preview label, the
 * articles it wrote, its container's name, and worker activity flags.
 */
export type SessionListEntry = Session & {
  preview: string | null;
  articles: ArticleSummary[];
  projectName: string | null;
  hasWaitingChild: boolean;
  hasRunningChild: boolean;
};

/**
 * Enrich session `rows` into listing entries — preview label, written
 * articles, owning project's name, and whether delegated children are running
 * or waiting on approval — batched, so the query count is flat in the page
 * size. The one projection every session listing shares (the sessions list,
 * the activity feed, a project's page), so rows render identically wherever
 * they surface.
 */
export function buildSessionListEntries(db: KiriDb, rows: Session[]): SessionListEntry[] {
  const ids = rows.map((row) => row.id);
  const previews = getSessionPreviews(db, ids);
  const waitingChildren = getSessionsWithWaitingChildren(db, ids);
  const runningChildren = new Set(
    ids.length > 0
      ? db
          .select({ parentSessionId: sessions.parentSessionId })
          .from(sessions)
          .where(and(inArray(sessions.parentSessionId, ids), eq(sessions.status, "running")))
          .all()
          .flatMap((row) => row.parentSessionId ?? [])
      : [],
  );
  const articlesBySessionId = articleSummariesByOwner(db, "sessionId", ids);
  const projectIds = [...new Set(rows.flatMap((row) => row.projectId ?? []))];
  const projectNames = new Map(
    projectIds.length > 0
      ? db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(inArray(projects.id, projectIds))
          .all()
          .map((project) => [project.id, project.name])
      : [],
  );
  return rows.map((row) => ({
    ...row,
    preview: previews.get(row.id) ?? null,
    articles: articlesBySessionId.get(row.id) ?? [],
    projectName: row.projectId !== null ? (projectNames.get(row.projectId) ?? null) : null,
    hasWaitingChild: waitingChildren.has(row.id),
    hasRunningChild: runningChildren.has(row.id),
  }));
}

/** Read a session's messages in order. */
export function getSessionMessages(db: KiriDb, sessionId: string): Message[] {
  return db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.index))
    .all()
    .map(toMessage);
}

/** Read a session's last message, or `undefined` while it has none. */
export function getLastMessage(db: KiriDb, sessionId: string): Message | undefined {
  const row = db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(desc(messages.index))
    .limit(1)
    .get();
  return row && toMessage(row);
}

/** Read one of a session's messages by id, or `undefined` if it has no such message. */
export function getMessage(db: KiriDb, sessionId: string, messageId: string): Message | undefined {
  const row = db
    .select()
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), eq(messages.id, messageId)))
    .get();
  return row && toMessage(row);
}

// Runs inside the message mutation's transaction, including any outer checkpoint.
function advanceTranscriptRevision(db: KiriDb, sessionId: string): number {
  const row = db
    .update(sessions)
    .set({ transcriptRevision: sql`${sessions.transcriptRevision} + 1` })
    .where(eq(sessions.id, sessionId))
    .returning({ revision: sessions.transcriptRevision })
    .get();
  if (!row) throw new Error(`session "${sessionId}" not found`);
  return row.revision;
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
  return db.transaction(() => {
    const index = (
      db
        .select({ count: count() })
        .from(messages)
        .where(eq(messages.sessionId, sessionId))
        .get() as { count: number }
    ).count;
    const id = opts.id ?? crypto.randomUUID();
    db.insert(messages)
      .values({
        id,
        sessionId,
        index,
        role: message.role,
        parts: message.parts,
        partsFormat: CURRENT_PARTS_FORMAT,
        contextTokens: message.contextTokens ?? null,
        createdAt: opts.createdAt ?? new Date(),
      })
      .run();
    advanceTranscriptRevision(db, sessionId);
    return toMessage(
      db.select().from(messages).where(eq(messages.id, id)).get() as typeof messages.$inferSelect,
    );
  });
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
  db.transaction(() => {
    const result = db
      .update(messages)
      .set({
        parts: update.parts,
        partsFormat: CURRENT_PARTS_FORMAT,
        ...("contextTokens" in update ? { contextTokens: update.contextTokens ?? null } : {}),
      })
      .where(and(eq(messages.sessionId, sessionId), eq(messages.id, messageId)))
      .returning({ id: messages.id })
      .get();
    if (result !== undefined) advanceTranscriptRevision(db, sessionId);
  });
}

/**
 * Delete the message `messageId` and every message after it in the session.
 * Rolls a transcript back to an earlier point — e.g. editing and resending a
 * user message, which discards that message and the turns that followed.
 * Trailing rows are removed wholesale rather than gapped, so the append-at-count
 * invariant in `appendMessage` still holds. Returns the committed revision;
 * truncating from an absent message changes nothing.
 */
export function deleteMessagesFrom(
  db: KiriDb,
  sessionId: string,
  messageId: string,
): number | undefined {
  return db.transaction(() => {
    const target = db
      .select({ index: messages.index })
      .from(messages)
      .where(and(eq(messages.sessionId, sessionId), eq(messages.id, messageId)))
      .get();
    if (!target) return undefined;
    db.delete(messages)
      .where(and(eq(messages.sessionId, sessionId), gte(messages.index, target.index)))
      .run();
    return advanceTranscriptRevision(db, sessionId);
  });
}

/**
 * Move a session to `status` and return the updated row. Pass `error` and/or
 * `finishedAt` to set them in the same write (a terminal `failed`/`cancelled`
 * carries both); omit them to leave the existing values untouched.
 */
export function setSessionStatus(
  db: KiriDb,
  sessionId: string,
  status: SessionStatus,
  update: { error?: unknown; finishedAt?: Date | null } = {},
): Session {
  db.update(sessions)
    .set({
      status,
      ...("error" in update ? { error: update.error } : {}),
      ...("finishedAt" in update ? { finishedAt: update.finishedAt } : {}),
    })
    .where(eq(sessions.id, sessionId))
    .run();
  return getSession(db, sessionId) as Session;
}

/** The project and parent a session's events name, so their lists of it refresh. */
export const sessionOwners = (
  session: Pick<Session, "projectId" | "parentSessionId">,
): SessionOwners => ({
  projectId: session.projectId,
  parentSessionId: session.parentSessionId,
});

/** A session operation refused because of the state the session or its family is in. */
export class SessionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionConflictError";
  }
}

/** What a move into a project changed: the sessions moved, and the articles that went with them, named by the session each left. */
export interface SessionMove {
  family: Session[];
  articles: { id: string; slug: string; sessionId: string | null }[];
}

/**
 * Move a projectless top-level session into a project, taking its delegated
 * children and every article the family wrote with it: the sessions join the
 * project and their articles become part of its shared corpus. The checks and
 * the transfer share one transaction, so a refused move changes nothing.
 * Throws `SessionConflictError` for a delegated session, one already in a
 * project, a family with a turn running or an approval pending, or an article
 * slug the corpus — or another moving article — already uses.
 */
export function moveSessionToProject(db: KiriDb, session: Session, projectId: string): SessionMove {
  if (session.parentSessionId !== null) {
    throw new SessionConflictError("Move the parent session to move its delegated sessions.");
  }
  if (session.projectId !== null) {
    throw new SessionConflictError("This session already belongs to a project.");
  }

  return db.transaction(() => {
    const family = [session, ...getSessionChildren(db, session.id)];
    if (family.some((row) => row.status === "running" || row.status === "waiting")) {
      throw new SessionConflictError(
        "Finish or cancel all turns and resolve pending approvals before moving.",
      );
    }

    const ids = family.map((row) => row.id);
    const moving = db
      .select({ id: articles.id, slug: articles.slug, sessionId: articles.sessionId })
      .from(articles)
      .where(inArray(articles.sessionId, ids))
      .all();
    const slugs = new Set(
      db
        .select({ slug: articles.slug })
        .from(articles)
        .where(eq(articles.projectId, projectId))
        .all()
        .map((row) => row.slug),
    );
    for (const article of moving) {
      if (slugs.has(article.slug)) {
        throw new SessionConflictError(
          `Article slug "${article.slug}" conflicts. Choose another project or resolve the duplicate before moving.`,
        );
      }
      slugs.add(article.slug);
    }

    db.update(articles)
      .set({ sessionId: null, projectId })
      .where(inArray(articles.sessionId, ids))
      .run();
    db.update(sessions).set({ projectId }).where(inArray(sessions.id, ids)).run();

    return { family: family.map((row) => ({ ...row, projectId })), articles: moving };
  });
}

/** A deleted session, with the owners its deletion is announced to. */
export type DeletedSession = Pick<Session, "id" | "projectId" | "parentSessionId">;

/**
 * Delete the given sessions and their children with all session-owned records
 * in one transaction. Accepts an existing transaction so container deletion
 * can roll back the entire operation. Unguarded: the caller has already
 * established that nothing in these families is running. Children cannot
 * delegate, so one level of descendants is complete. Returns every session
 * deleted, children included, for announcing.
 */
export function deleteSessions(
  db: Pick<KiriDb, "transaction">,
  sessionIds: string[],
): DeletedSession[] {
  if (sessionIds.length === 0) return [];
  return db.transaction((tx) => {
    const deleted = tx
      .select({
        id: sessions.id,
        projectId: sessions.projectId,
        parentSessionId: sessions.parentSessionId,
      })
      .from(sessions)
      .where(or(inArray(sessions.id, sessionIds), inArray(sessions.parentSessionId, sessionIds)))
      .all();
    const ids = deleted.map((row) => row.id);
    const childIds = deleted
      .filter((row) => row.parentSessionId !== null && sessionIds.includes(row.parentSessionId))
      .map((row) => row.id);
    tx.delete(articles).where(inArray(articles.sessionId, ids)).run();
    tx.delete(messages).where(inArray(messages.sessionId, ids)).run();
    tx.delete(sessionInbox).where(inArray(sessionInbox.sessionId, ids)).run();
    // Children first: they hold an FK to the parent, and foreign_keys is ON.
    if (childIds.length > 0) tx.delete(sessions).where(inArray(sessions.id, childIds)).run();
    tx.delete(sessions).where(inArray(sessions.id, sessionIds)).run();
    return deleted;
  });
}

/**
 * Delete a session and its children with all owned records; an absent id is a
 * no-op. A running turn persists as it streams, and a delegated worker runs
 * detached from its parent's turns, so either one in flight refuses the delete
 * with `SessionConflictError` until it is cancelled. The check and the delete
 * share one transaction. Returns every session deleted, for announcing.
 */
export function deleteSession(db: KiriDb, id: string): DeletedSession[] {
  return db.transaction(() => {
    const session = getSession(db, id);
    if (!session) return [];

    if (session.status === "running") {
      throw new SessionConflictError(`session "${id}" has a turn in flight; cancel it first`);
    }
    if (getSessionChildren(db, id).some((child) => child.status === "running")) {
      throw new SessionConflictError(
        `session "${id}" has a delegated worker running; cancel it first`,
      );
    }

    return deleteSessions(db, [id]);
  });
}
