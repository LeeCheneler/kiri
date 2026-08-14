import { useEffect, useRef, useState } from "react";
import { type SessionMessage, fetchSuggestedReplies } from "../../api.ts";
import {
  SUGGESTED_REPLIES_TTL_MS,
  readSuggestedReplies,
  writeSuggestedReplies,
} from "./suggested-replies-cache.ts";

// The text a chip answers: the message's text parts, joined.
const textOf = (parts: SessionMessage["parts"]): string =>
  parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();

/**
 * The suggested tap-to-send replies for a session's settled last turn — empty
 * whenever the moment isn't right: a turn in flight or awaiting approval, a
 * last message that isn't a recent assistant reply with text, or simply no
 * suggestions. Asks the server once per settled turn: the local cache keeps
 * every answer, empty included, so revisits and remounts never re-generate.
 * The server re-checks every condition, so this gate is economy, not
 * correctness.
 */
export function useSuggestedReplies(opts: {
  sessionId: string;
  /**
   * The persisted transcript. It refetches after each settle — and `busy`
   * reads the same query's session row — so by the time `busy` clears, the
   * last entry here is the turn that just settled, never a half-written one.
   */
  messages: SessionMessage[];
  /** A turn is in flight, whether driven from this view or elsewhere. */
  busy: boolean;
  awaitingApproval: boolean;
}): string[] {
  const { sessionId, messages, busy, awaitingApproval } = opts;
  const [suggested, setSuggested] = useState<{ messageId: string; replies: string[] } | null>(null);
  // The message id a fetch is in flight for, so a settled turn is generated
  // for once even when the effect re-runs mid-flight (a StrictMode double
  // mount, an unrelated transcript refetch).
  const fetchingFor = useRef<string | null>(null);

  const last = messages.at(-1);
  const target =
    !busy &&
    !awaitingApproval &&
    last !== undefined &&
    last.role === "assistant" &&
    textOf(last.parts) !== "" &&
    Date.now() - new Date(last.createdAt).getTime() <= SUGGESTED_REPLIES_TTL_MS
      ? last
      : undefined;

  useEffect(() => {
    if (target === undefined) return;
    const cached = readSuggestedReplies(target.id);
    if (cached !== undefined) {
      // Bail to the identical state when it's already held, so the cache-hit
      // path settles instead of re-rendering forever.
      setSuggested((prev) =>
        prev?.messageId === target.id ? prev : { messageId: target.id, replies: cached },
      );
      return;
    }
    if (fetchingFor.current === target.id) return;
    fetchingFor.current = target.id;
    // Deliberately not aborted on cleanup: the answer is worth caching either
    // way, and rendering is gated on the message still being the last — a
    // response landing after the user moved on writes the cache and shows
    // nothing.
    fetchSuggestedReplies(sessionId)
      .then((replies) => {
        writeSuggestedReplies(target.id, replies);
        setSuggested({ messageId: target.id, replies });
      })
      .catch(() => {
        // No chips on a failed generation; the server logs its own half.
      })
      .finally(() => {
        if (fetchingFor.current === target.id) fetchingFor.current = null;
      });
  }, [target, sessionId]);

  return target !== undefined && suggested?.messageId === target.id ? suggested.replies : [];
}
