import { useChat } from "@ai-sdk/react";
import {
  type ChatStatus,
  DefaultChatTransport,
  type UIMessage,
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { useCallback, useEffect, useMemo } from "react";
import {
  cancelSession,
  recordToolGrant,
  sessionTurnEndpoint,
  truncateSessionMessages,
} from "../../api.ts";
import { CANCELLED_ERROR_TEXT, type ToolDecisionHandler } from "./tool-invocation.tsx";

// Tool-call states that mean a call is still running.
const IN_FLIGHT_TOOL_STATES = new Set(["input-streaming", "input-available", "approval-responded"]);

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
  /** Cancel the in-flight turn and mark any running tool call cancelled. */
  cancel: () => void;
  /** Resolve a pending tool approval (Allow / Always allow / Deny). */
  onToolDecision: ToolDecisionHandler;
}

/**
 * Drive one session's live conversation: wires `useChat` to the session's turn
 * endpoint, reconciles a turn that finished or ran elsewhere while this view
 * wasn't streaming, and exposes the send / resubmit / cancel / tool-approval
 * handlers. The page chat and the embedded investigation view share this engine;
 * each renders its own chrome around it.
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
      prepareSendMessagesRequest: ({ messages }) => ({ body: { message: messages.at(-1) } }),
    });
  }, [session.id]);

  const { messages, sendMessage, status, stop, error, setMessages, addToolApprovalResponse } =
    useChat({
      id: session.id,
      messages: initialMessages,
      transport,
      // Once every pending tool approval on the latest turn has a verdict, send
      // it straight back so the turn resumes without another user action.
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    });

  // `streaming` is this view driving the turn. `busy` is a turn in flight at all
  // — including one started elsewhere, or left running when we navigated away:
  // the session row reports `running` while `useChat` sits idle here.
  const streaming = status === "submitted" || status === "streaming";
  const busy = streaming || session.status === "running";

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
  // shows up here.
  useEffect(() => {
    if (streaming) return;
    if (initialMessages.length > messages.length) setMessages(initialMessages);
  }, [streaming, initialMessages, messages.length, setMessages]);

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

  // Resolve a pending tool approval. Allow runs it once; Always allow also
  // records a grant so the tool stops prompting; Deny refuses it. Responding
  // makes `useChat` send the turn back to resume (via `sendAutomaticallyWhen`).
  const onToolDecision = useCallback<ToolDecisionHandler>(
    (part, decision) => {
      if (part.state !== "approval-requested") return;
      // Persist the grant before approving; fire-and-forget, since a failed write
      // just means we ask again next time — the safe default — and must not block
      // allowing the call now.
      if (decision === "always") void recordToolGrant(getToolName(part)).catch(() => {});
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
    cancel,
    onToolDecision,
  };
}
