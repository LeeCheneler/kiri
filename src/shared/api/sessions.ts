import type { UIMessage } from "ai";
import type { ArticleSummary } from "./articles.ts";

/**
 * Session lifecycle status. `idle` is the resting state between turns;
 * `waiting` is a turn paused on tool-approval requests, blocked on the user.
 */
export type SessionStatus = "running" | "waiting" | "idle" | "failed" | "cancelled";

/** How hard a session's model reasons, lowest to highest. */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
/** One of the supported reasoning effort levels. */
export type SessionEffort = (typeof EFFORT_LEVELS)[number];

/** A session row as returned by the sessions API. */
export interface Session {
  id: string;
  /** Current stored revision; SessionDetail carries the revision of its returned messages. */
  transcriptRevision: number;
  status: SessionStatus;
  /** `provider:model` id the session's turns run against. */
  model: string;
  /** `provider:model` id the session generates images with, or null when image generation is off. */
  imageModel: string | null;
  /** How hard the session's model reasons; applied from the next turn like the model. */
  effort: SessionEffort;
  /** Absolute directory the session works from, or null when no sandbox was configured at create. */
  cwd: string | null;
  /** The session's display name, or null when untitled — lists fall back to the preview. */
  title: string | null;
  /** The project this session belongs to, or null until created in or moved into a project. */
  projectId: string | null;
  /** The parent session this one was spawned from, or null for a top-level session. */
  parentSessionId: string | null;
  /** The parent's spawning tool call, or null for a top-level session. */
  parentToolCallId: string | null;
  startedAt: string;
  /** Set once the session reaches a terminal `failed`/`cancelled`; null while usable. */
  finishedAt: string | null;
  error: unknown;
}

/** A persisted message on a session. `parts` is an AI SDK `UIMessage` parts array. */
export interface SessionMessage {
  id: string;
  sessionId: string;
  index: number;
  role: "user" | "assistant" | "system";
  parts: UIMessage["parts"];
  /** The context footprint after this message's turn; null for user messages and when a provider reported none. */
  contextTokens: number | null;
  createdAt: string;
}

/**
 * A session as it appears in the list: the row plus a `preview` label drawn
 * from its first user message (`null` while the session is titled, or until
 * one has been sent), which the list leads with when there is no title, and
 * the articles it has written —
 * summary metadata only, ordered by creation, so the row can lead with them
 * the way a run row does.
 */
export interface SessionListEntry extends Session {
  preview: string | null;
  articles: ArticleSummary[];
  /** The owning project's display name, or null for a projectless session. */
  projectName: string | null;
  /** True while a delegated child sits waiting on tool approval — a worker blocked on the user. */
  hasWaitingChild: boolean;
  /** True while a delegated child is running a turn. */
  hasRunningChild: boolean;
}

/**
 * One page of the reverse-chronological session list. `nextCursor` is the last
 * row's `id` when a further page exists; `null` on the final page.
 */
export interface SessionsPage {
  sessions: SessionListEntry[];
  nextCursor: string | null;
}

/** A message queued in a session's inbox, awaiting delivery at a turn boundary. */
export interface SessionInboxItem {
  id: string;
  /** Who queued it: the user, the session's parent, or one of its delegated workers. */
  source: "user" | "parent" | "child";
  text: string;
  /** A child sender's session id, naming the worker by its live title; null for the other sources. */
  fromSessionId: string | null;
  createdAt: string;
}

/** A session with its ordered messages and undelivered inbox, as returned by `GET /api/sessions/:id`. */
export interface SessionDetail {
  /** Revision of `messages`; a view rejoining a running turn names it, and is replayed into only from there. */
  transcriptRevision: number;
  session: Session;
  messages: SessionMessage[];
  inbox: SessionInboxItem[];
  /** The spawning session's id and display label for a delegated child; null for a top-level session. */
  parent: { id: string; label: string } | null;
}

/** A delegated child as the children listing carries it: the session row plus when it last moved. */
export interface ChildSessionEntry extends Session {
  /** The child's newest message's timestamp, else its start — recency without loading its transcript. */
  lastActivityAt: string;
}

/** Session response body. */
export type SessionResult = { session: Session };

/** SessionChildren response body. */
export type SessionChildrenResult = { children: ChildSessionEntry[] };

/** SuggestedReplies response body. */
export type SuggestedRepliesResult = { replies: string[] };

/** Transcription response body. */
export type TranscriptionResult = { text: string };

/** SessionCancel response body. */
export type SessionCancelResult = { sessionId: string };

/**
 * SessionInbox response body. `delivered` is true when a repeated submission
 * finds its message already handed to a turn: it is in the transcript, not
 * the backlog.
 */
export type SessionInboxResult = { item: SessionInboxItem; delivered: boolean };

/** CreateSession request body. */
export type CreateSessionRequest = { model: string; imageModel?: string; projectId?: string };

/** PatchSession request body. */
export type PatchSessionRequest = {
  model?: string;
  imageModel?: string | null;
  effort?: SessionEffort;
  title?: string | null;
};

/** MoveSession request body. */
export type MoveSessionRequest = { projectId: string };

/**
 * QueueSessionMessage request body. `id` is chosen by the sender and names the
 * submission: repeating it returns the message already queued under it rather
 * than queueing another.
 */
export type QueueSessionMessageRequest = { id: string; text: string };

/** A part of a user message a turn accepts: typed text, or an attachment inlined as a data URL. */
export type SessionUserPart =
  | { type: "text"; text: string }
  | { type: "file"; mediaType: string; url: string; filename?: string };

/** The user's verdict on one tool call a turn is paused on. */
export type ToolApprovalVerdict = { toolCallId: string; approved: boolean };

/**
 * SessionTurn request body: a new user message, or — resuming a turn paused
 * on tool approval — one verdict for each call it is paused on.
 */
export type SessionTurnRequest =
  | { message: { id?: string; parts: SessionUserPart[] } }
  | { approvals: ToolApprovalVerdict[] };

/** Committed revision after truncating a transcript. */
export interface TranscriptMutationResult {
  transcriptRevision: number;
}
