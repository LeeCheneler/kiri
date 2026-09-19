import { ApiError, type SessionInboxResult, queueSessionMessage } from "../../api.ts";

// Waits between repeats of a submission whose outcome never arrived.
const RETRY_DELAYS_MS = [300, 1_500, 4_000];

/**
 * Whether a failed request was refused outright. Anything else — no response
 * at all, or a server error — leaves its outcome unknown: the message may have
 * been queued all the same.
 */
export const isRefusal = (cause: unknown): cause is ApiError =>
  cause instanceof ApiError && cause.status >= 400 && cause.status < 500;

/** What to tell the user about a message that was not queued. */
export const queueFailureText = (cause: unknown): string =>
  isRefusal(cause)
    ? cause.message
    : "Couldn't confirm the message was queued, so it is back in the composer.";

/**
 * Queue `text` for a session under `id`, repeating the same submission while
 * its outcome is unknown. The id makes the repeat safe: the server answers
 * with the message it already queued rather than queueing another. Rejects
 * with the refusal, or with the last failure once the repeats run out.
 */
export async function submitQueuedMessage(
  sessionId: string,
  id: string,
  text: string,
  delaysMs: number[] = RETRY_DELAYS_MS,
): Promise<SessionInboxResult> {
  for (const delay of delaysMs) {
    try {
      return await queueSessionMessage(sessionId, id, text);
    } catch (cause) {
      if (isRefusal(cause)) throw cause;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return queueSessionMessage(sessionId, id, text);
}
