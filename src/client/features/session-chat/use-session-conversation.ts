import { useChat } from "@ai-sdk/react";
import {
  type ChatStatus,
  DefaultChatTransport,
  type UIMessage,
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  cancelSession,
  sessionStreamEndpoint,
  sessionTurnEndpoint,
  setToolPermission,
  truncateSessionMessages,
} from "../../api.ts";
import { useTruncateSessionDetail } from "../../state/sessions.ts";
import { CANCELLED_ERROR_TEXT, type ToolDecisionHandler } from "./tool-invocation.tsx";

// Tool-call states that mean a call is still running.
const IN_FLIGHT_TOOL_STATES = new Set(["input-streaming", "input-available", "approval-responded"]);

// Total parts across a transcript. A turn that finished elsewhere can grow an
// existing message in place rather than add a new one — an approval resume
// extends the paused assistant message, and a delegated child's single
// assistant turn gains a part per inner tool call — so the fold-in below
// compares parts, not just the message count.
const totalParts = (messages: UIMessage[]): number =>
  messages.reduce((sum, message) => sum + message.parts.length, 0);

// Rewrite any still-running tool call to a terminal cancelled state. Cancelling
// a turn stops a call mid-flight, which otherwise leaves its part on "working"
// in the transcript; this marks it cancelled instead. Other parts pass through.
function cancelInFlightTools(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) =>
    message.role === "assistant"
      ? {
          ...message,
          parts: message.parts.map((part) =>
            isToolUIPart(part) && IN_FLIGHT_TOOL_STATES.has(part.state)
              ? ({
                  ...part,
                  state: "output-error",
                  errorText: CANCELLED_ERROR_TEXT,
                } as UIMessage["parts"][number])
              : part,
          ),
        }
      : message,
  );
}

/** The live conversation engine for one session, returned by `useSessionConversation`. */
export interface SessionConversation {
  /** The live transcript — seeded from the persisted history, then owned by `useChat`. */
  messages: UIMessage[];
  status: ChatStatus;
  error: Error | undefined;
  /** This view is driving a turn (submitted or streaming). */
  streaming: boolean;
  /** A turn is in flight at all — including one started elsewhere or left running on revisit. */
  busy: boolean;
  /** A tool call on the latest turn is awaiting the user's Allow / Deny verdict. */
  awaitingApproval: boolean;
  /** Start a turn from composed parts. */
  sendMessage: ReturnType<typeof useChat<UIMessage>>["sendMessage"];
  /** Replace the local transcript (used by cancel and resubmit). */
  setMessages: ReturnType<typeof useChat<UIMessage>>["setMessages"];
  /** Resend an edited user message, truncating the transcript back to it first. */
  resubmit: (messageId: string, parts: UIMessage["parts"]) => Promise<void>;
  /** Delete a user message — and everything after it — without resending. */
  deleteMessage: (messageId: string) => Promise<void>;
  /** Cancel the in-flight turn and mark any running tool call cancelled. */
  cancel: () => void;
  /** Resolve a pending tool approval (Allow / Always allow / Deny). */
  onToolDecision: ToolDecisionHandler;
}

/**
 * Drive one session's live conversation: wires `useChat` to the session's turn
 * endpoint, rejoins an in-flight turn's stream on mount, reconciles a turn
 * that finished or ran elsewhere while this view wasn't streaming, and exposes
 * the send / resubmit / cancel / tool-approval handlers. The page chat and the
 * embedded child-session view share this engine; each renders its own chrome
 * around it.
 */
export function useSessionConversation(opts: {
  session: { id: string; status: string };
  /** The persisted transcript to seed once; `useChat` owns the live state after mount. */
  initialMessages: UIMessage[];
}): SessionConversation {
  const { session, initialMessages } = opts;

  const transport = useMemo(() => {
    const { url, headers } = sessionTurnEndpoint(session.id);
    return new DefaultChatTransport<UIMessage>({
      api: url,
      headers,
      // Send only the new message; the server loads the prior turns.
      prepareSendMessagesRequest: ({ messages }) => ({
        body: { message: messages.at(-1) },
      }),
      // Resume reconnects to the GET stream endpoint, not the POST turn `api`.
      prepareReconnectToStreamRequest: () => ({ api: sessionStreamEndpoint(session.id) }),
    });
  }, [session.id]);

  const {
    messages,
    sendMessage,
    status,
    stop,
    error,
    setMessages,
    addToolApprovalResponse,
    resumeStream,
  } = useChat({
    id: session.id,
    messages: initialMessages,
    transport,
    // Cap transcript re-renders to ~16/s. A fast provider otherwise delivers
    // deltas quicker than a grown transcript can re-render, and the backlog
    // pins the main thread until the tab freezes; 60 ms still reads as live
    // streaming.
    experimental_throttle: 60,
    // Once every pending tool approval on the latest turn has a verdict, send it
    // straight back so the turn resumes without another user action.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  // Reconnect to an in-flight turn's stream once per session, so a page refresh
  // (or a second tab) rejoins the live response — tokens and tool-call state —
  // and carries it to completion; a 204 when no turn is running makes it a no-op.
  // Guarded by session id so it fires once per session even though StrictMode
  // double-invokes effects in dev — two reconnects would replay the buffer twice
  // and duplicate the turn — and so it re-fires when the session changes.
  const resumedFor = useRef<string | null>(null);
  useEffect(() => {
    if (resumedFor.current === session.id) return;
    resumedFor.current = session.id;
    void resumeStream();
  }, [session.id, resumeStream]);

  // `streaming` is this view driving the turn. `busy` is a turn in flight at all
  // — including one started elsewhere, or left running when we navigated away:
  // the session row reports `running` while `useChat` sits idle here.
  const streaming = status === "submitted" || status === "streaming";
  const busy = streaming || session.status === "running";

  // A tool call on the latest turn is waiting on the user's Allow / Deny verdict.
  // The turn is idle (not `busy`) meanwhile, but a new message can't be sent
  // until it's resolved — the model can't continue past an unanswered call.
  const awaitingApproval = useMemo(() => {
    const last = messages.at(-1);
    return (
      last?.role === "assistant" &&
      last.parts.some((part) => isToolUIPart(part) && part.state === "approval-requested")
    );
  }, [messages]);

  // A turn can finish while this view is unmounted (we navigated away) or be
  // driven from elsewhere: it persists without `useChat` — which ignores
  // re-seeds after mount — ever seeing it. When we're not the one streaming and
  // the stored transcript has pulled ahead, fold it in so the finished turn
  // shows up here. "Pulled ahead" is more messages or more parts: an approval
  // answered elsewhere extends the paused assistant message in place, so a
  // message-count check alone would never re-sync it.
  // A local delete leaves `initialMessages` one commit behind: useChat's store
  // notifies synchronously while the query cache batches its notification into
  // a microtask, so the fold-in below would resurrect the dropped turns from
  // the stale snapshot. Remember the cut message and skip folding in any
  // snapshot that still carries it; the ref clears once a fresh one arrives.
  const truncatedAt = useRef<string | null>(null);

  useEffect(() => {
    if (streaming) return;
    if (truncatedAt.current !== null) {
      const id = truncatedAt.current;
      if (initialMessages.some((message) => message.id === id)) return;
      truncatedAt.current = null;
    }
    if (
      initialMessages.length > messages.length ||
      totalParts(initialMessages) > totalParts(messages)
    )
      setMessages(initialMessages);
  }, [streaming, initialMessages, messages, setMessages]);

  // Resend an edited user message, re-running the conversation from it. Truncate
  // the stored transcript back to the message first (so the turn's server-side
  // append lands at the right index), then drop the local messages from that
  // point and send the edited turn in the same tick — `sendMessage` flips
  // `streaming` before the fold-in effect could re-expand them from a now-stale
  // refetch. A failed truncate aborts the resend, leaving the transcript intact.
  const resubmit = useCallback(
    async (messageId: string, parts: UIMessage["parts"]) => {
      if (busy) return;
      const index = messages.findIndex((message) => message.id === messageId);
      if (index === -1) return;
      await truncateSessionMessages(session.id, messageId);
      setMessages(messages.slice(0, index));
      void sendMessage({ parts });
    },
    [busy, messages, session.id, setMessages, sendMessage],
  );

  // Delete a message without resending: truncate the stored transcript from it,
  // mirror the cut into the cached session detail, then drop the local messages
  // from that point. Unlike resubmit, nothing flips `streaming` here, so the
  // cached (longer) transcript must shrink before the fold-in effect above
  // could re-expand the dropped turns from it. A failed truncate aborts,
  // leaving the transcript intact.
  const truncateDetail = useTruncateSessionDetail(session.id);
  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (busy) return;
      const index = messages.findIndex((message) => message.id === messageId);
      if (index === -1) return;
      await truncateSessionMessages(session.id, messageId);
      truncatedAt.current = messageId;
      truncateDetail(messageId);
      setMessages(messages.slice(0, index));
    },
    [busy, messages, session.id, truncateDetail, setMessages],
  );

  // Resolve a pending tool approval. Allow runs it once; Always allow also sets
  // the tool's standing permission to "allow" so it stops prompting; Deny refuses
  // it. Responding makes `useChat` send the turn back to resume (via
  // `sendAutomaticallyWhen`).
  const onToolDecision = useCallback<ToolDecisionHandler>(
    (part, decision) => {
      if (part.state !== "approval-requested") return;
      // Persist the permission before approving; fire-and-forget, since a failed
      // write just means we ask again next time — the safe default — and must not
      // block allowing the call now.
      if (decision === "always") void setToolPermission(getToolName(part), "allow").catch(() => {});
      void addToolApprovalResponse({ id: part.approval.id, approved: decision !== "deny" });
    },
    [addToolApprovalResponse],
  );

  const cancel = useCallback(() => {
    void stop();
    // Best-effort: abort the server turn too. A 404/409 means it already settled.
    void cancelSession(session.id).catch(() => {});
    // Stopping mid-call leaves the tool part on "working"; mark it cancelled so
    // the transcript reflects the stop rather than spinning forever.
    setMessages(cancelInFlightTools);
  }, [stop, session.id, setMessages]);

  return {
    messages,
    status,
    error,
    streaming,
    busy,
    awaitingApproval,
    sendMessage,
    setMessages,
    resubmit,
    deleteMessage,
    cancel,
    onToolDecision,
  };
}
