import type {
  Session,
  SessionInboxItem,
  SessionListEntry,
  SessionMessage,
} from "../../../shared/api/sessions.ts";
import type { messages, sessionInbox, sessions } from "../../db/schema.ts";
import type { SessionListEntry as StoredSessionListEntry } from "../../sessions/store.ts";
import { serializeArticleSummary } from "./articles.ts";

/** Serialize a session's timestamps while preserving its persisted fields. */
export const serializeSession = (row: typeof sessions.$inferSelect): Session => ({
  ...row,
  startedAt: row.startedAt.toISOString(),
  finishedAt: row.finishedAt?.toISOString() ?? null,
});
/** Serialize a persisted transcript message. */
export const serializeMessage = (row: typeof messages.$inferSelect): SessionMessage => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
});
/** Serialize an inbox row. */
export const serializeInboxItem = (row: typeof sessionInbox.$inferSelect): SessionInboxItem => ({
  id: row.id,
  source: row.source,
  text: row.text,
  fromSessionId: row.fromSessionId,
  createdAt: row.createdAt.toISOString(),
});
/** Serialize a session listing with its article timestamps. */
export const serializeSessionListEntry = (row: StoredSessionListEntry): SessionListEntry => ({
  ...row,
  ...serializeSession(row),
  articles: row.articles.map(serializeArticleSummary),
});
