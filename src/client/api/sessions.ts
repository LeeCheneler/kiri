import type { PageQuery } from "../../shared/api/pagination.ts";
import type {
  ChildSessionEntry,
  SessionCancelResult,
  SessionChildrenResult,
  SessionDetail,
  SessionEffort,
  SessionInboxResult,
  SessionResult,
  SessionsPage,
  SuggestedRepliesResult,
  TranscriptMutationResult,
  TranscriptionResult,
} from "../../shared/api/sessions.ts";
import type * as requests from "../../shared/api/sessions.ts";

import {
  CLIENT_HEADER_NAME,
  CLIENT_HEADER_VALUE,
  apiFetch,
  apiUrl,
  assertOk,
  json,
} from "./http.ts";

/**
 * Fetch one page of the session list, newest first. Pass `cursor` from the
 * previous page's `nextCursor` to advance and `limit` (1–100) to size the
 * page. Throws on non-2xx.
 */
export const fetchSessionsPage = async (opts: PageQuery = {}): Promise<SessionsPage> => {
  const params = new URLSearchParams();
  if (opts.cursor !== undefined) params.set("cursor", opts.cursor);
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return json<SessionsPage>(await apiFetch(`/api/sessions${qs ? `?${qs}` : ""}`));
};

/** Fetch a single session with its messages. Throws on non-2xx (404 for unknown ids). */
export const fetchSession = async (id: string, signal?: AbortSignal): Promise<SessionDetail> =>
  json<SessionDetail>(await apiFetch(`/api/sessions/${encodeURIComponent(id)}`, { signal }));

/**
 * Fetch the child sessions a session's delegate calls have spawned, oldest
 * first. Children are hidden from the list and feed, so this is the transcript's
 * lookup for the session behind a delegate call. Throws on non-2xx.
 */
export const fetchSessionChildren = async (id: string): Promise<ChildSessionEntry[]> =>
  (
    await json<SessionChildrenResult>(
      await apiFetch(`/api/sessions/${encodeURIComponent(id)}/children`),
    )
  ).children;

/**
 * Fetch tap-to-send suggested replies to the session's settled last turn,
 * generated on demand against the workspace's utility model. Empty for every
 * "not now" case — no utility model configured, a turn in flight or awaiting
 * approval, a last message a short reply can't answer. Throws on non-2xx.
 */
export const fetchSuggestedReplies = async (id: string): Promise<string[]> =>
  (
    await json<SuggestedRepliesResult>(
      await apiFetch(`/api/sessions/${encodeURIComponent(id)}/suggested-replies`),
    )
  ).replies;

/**
 * Transcribe a push-to-talk recording into trimmed draft text. The server
 * sniffs the audio container, so
 * whatever the browser recorded goes as is. Empty when nothing was said.
 * Throws `ApiError` on non-2xx, notably 400 when no transcription model is
 * configured.
 */
export const transcribeAudio = async (audio: Blob): Promise<string> => {
  const body = new FormData();
  body.append("audio", audio, "recording");
  return (
    await json<TranscriptionResult>(await apiFetch("/api/transcribe", { method: "POST", body }))
  ).text;
};

/**
 * Create a session against `model` (a `provider:model` id), returning the new
 * row — navigate to it to start chatting. Pass `imageModel` to start with image
 * generation on, and `projectId` to create the session within a project.
 * Standalone sessions can move into a project later. Throws `ApiError` on non-2xx,
 * notably 400 when a model can't be resolved against the provider registry or
 * the project doesn't exist.
 */
export const createSession = async (
  model: string,
  imageModel?: string,
  projectId?: string,
): Promise<SessionResult> =>
  json<SessionResult>(
    await apiFetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        ...(imageModel !== undefined ? { imageModel } : {}),
        ...(projectId !== undefined ? { projectId } : {}),
      } satisfies requests.CreateSessionRequest),
    }),
  );

/**
 * Change a session's model (a `provider:model` id), returning the updated row.
 * The model resolves at the start of each turn, so the change takes effect from
 * the next turn. Throws `ApiError` on non-2xx — 404 for an unknown session, 400
 * when the model can't be resolved against the provider registry.
 */
export const patchSessionModel = async (id: string, model: string): Promise<SessionResult> =>
  json<SessionResult>(
    await apiFetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model } satisfies requests.PatchSessionRequest),
    }),
  );

/**
 * Change the `provider:model` id a session generates images with, or pass
 * `null` to turn image generation off. Resolved when an image is generated,
 * so the change applies to the next generation. Throws `ApiError` on non-2xx
 * — 404 for an unknown session, 400 when the model can't be resolved against
 * the provider registry.
 */
export const patchSessionImageModel = async (
  id: string,
  imageModel: string | null,
): Promise<SessionResult> =>
  json<SessionResult>(
    await apiFetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageModel } satisfies requests.PatchSessionRequest),
    }),
  );

/**
 * Change how hard a session's model reasons, returning the updated row.
 * Applied when the next turn maps it to provider reasoning parameters, so the
 * change takes effect from the next turn. Throws `ApiError` on non-2xx (404
 * for an unknown session).
 */
export const patchSessionEffort = async (
  id: string,
  effort: SessionEffort,
): Promise<SessionResult> =>
  json<SessionResult>(
    await apiFetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ effort } satisfies requests.PatchSessionRequest),
    }),
  );

/**
 * Rename a session, or pass `null` to clear its title back to the untitled
 * fallback, returning the updated row. A display field only — the list, feed,
 * and search results lead with it. Throws `ApiError` on non-2xx (404 for an
 * unknown session).
 */
export const patchSessionTitle = async (id: string, title: string | null): Promise<SessionResult> =>
  json<SessionResult>(
    await apiFetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title } satisfies requests.PatchSessionRequest),
    }),
  );

/** Move a standalone session and its articles into a project. Throws on conflicts or active turns. */
export const moveSessionToProject = async (id: string, projectId: string): Promise<SessionResult> =>
  json<SessionResult>(
    await apiFetch(`/api/sessions/${encodeURIComponent(id)}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId } satisfies requests.MoveSessionRequest),
    }),
  );

/**
 * Request cancellation of a session's in-flight turn. Resolves on 202 — the
 * turn's terminal `cancelled` status arrives on the SSE event stream. Throws
 * `ApiError` on non-2xx (404 unknown session, 409 when no turn is in flight).
 */
export const cancelSession = async (id: string): Promise<SessionCancelResult> =>
  json<SessionCancelResult>(
    await apiFetch(`/api/sessions/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  );

/**
 * Permanently delete a session and its messages. Resolves on 204 — the server
 * has removed the session row and its messages and published a `session.deleted`
 * event so live surfaces drop the row without a refetch. Throws `ApiError` on
 * non-2xx — 404 if the session doesn't exist (or was already deleted), 409 if a
 * turn is in flight (caller must cancel first).
 */
export const deleteSession = async (id: string): Promise<void> => {
  await assertOk(await apiFetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }));
};

/**
 * Truncate a session's transcript from `messageId` onward — the server deletes
 * that message and every turn after it, then rebuilds the running token totals.
 * Backs edit-and-resend: roll the conversation back to the edited message before
 * re-running from it. Returns the committed revision; throws `ApiError` on non-2xx — 404 (the
 * session or message is unknown), 409 (a turn is in flight; cancel it first).
 */
export const truncateSessionMessages = async (
  id: string,
  messageId: string,
): Promise<TranscriptMutationResult> =>
  json<TranscriptMutationResult>(
    await apiFetch(
      `/api/sessions/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}`,
      { method: "DELETE" },
    ),
  );

/**
 * Queue a message for a session whose turn is in flight; the turn delivers it
 * at its next step boundary. Resolves with the queued row — its `id` is the
 * handle `withdrawQueuedMessage` takes, and the id its delivered `data-inbox`
 * part carries in the transcript. Throws `ApiError` on non-2xx — 404 (unknown
 * session), 409 (no turn in flight to queue for; send it as a normal message
 * instead — the caller's race with the turn settling).
 */
export const queueSessionMessage = async (id: string, text: string): Promise<SessionInboxResult> =>
  json<SessionInboxResult>(
    await apiFetch(`/api/sessions/${encodeURIComponent(id)}/inbox`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text } satisfies requests.QueueSessionMessageRequest),
    }),
  );

/**
 * Withdraw a queued message that hasn't been delivered. Resolves `true` when
 * the item was still queued and is now removed, `false` when it no longer is —
 * the turn consumed it (or the session is gone). Auto-promotion keys off this:
 * a turn that settled without delivering the message hands it back here, and
 * the caller resends it as a normal turn without double-delivering. Throws
 * `ApiError` on other non-2xx.
 */
export const withdrawQueuedMessage = async (id: string, itemId: string): Promise<boolean> => {
  const res = await apiFetch(
    `/api/sessions/${encodeURIComponent(id)}/inbox/${encodeURIComponent(itemId)}`,
    { method: "DELETE" },
  );
  if (res.status === 404) return false;
  await assertOk(res);
  return true;
};

/**
 * The turn endpoint for a session's `useChat` transport: the origin-aware URL
 * plus the `X-Kiri-Client` header the CSRF gate requires. `useChat` posts only
 * the newest message here; the server loads the prior turns from storage.
 */
export const sessionTurnEndpoint = (
  id: string,
): { url: string; headers: Record<string, string> } => ({
  url: apiUrl(`/api/sessions/${encodeURIComponent(id)}/messages`),
  headers: { [CLIENT_HEADER_NAME]: CLIENT_HEADER_VALUE },
});

/**
 * The resume endpoint for a session's `useChat` reconnect — the origin-aware URL
 * the hook polls on mount when `resume` is set. A safe GET (no CSRF header), it
 * returns the in-flight turn's event-stream to rejoin, or 204 when none is live.
 */
export const sessionStreamEndpoint = (id: string): string =>
  apiUrl(`/api/sessions/${encodeURIComponent(id)}/stream`);
