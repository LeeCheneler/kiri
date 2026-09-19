import { useChat } from "@ai-sdk/react";
import {
  type ChatStatus,
  DefaultChatTransport,
  type UIMessage,
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MESSAGE_BODY_LIMIT_BYTES,
  MESSAGE_SIZE_ERROR,
  jsonBytes,
} from "../../../shared/message-limits.ts";
import {
  type SessionInboxItem,
  cancelSession,
  sessionStreamEndpoint,
  sessionTurnEndpoint,
  setToolPermission,
  truncateSessionMessages,
  withdrawQueuedMessage,
} from "../../api.ts";
import {
  usePatchSessionInbox,
  useRefreshSessionDetail,
  useTruncateSessionDetail,
} from "../../state/sessions.ts";
import { compactionStatusOf } from "./compaction-status.ts";
import { type LiveConsoleStore, createLiveConsoleStore, liveConsoleOf } from "./live-console.ts";
import { submitQueuedMessage } from "./queue-submission.ts";
import { CANCELLED_ERROR_TEXT, type ToolDecisionHandler } from "./tool-invocation.tsx";

// Tool-call states that mean a call is still running.
const IN_FLIGHT_TOOL_STATES = new Set(["input-streaming", "input-available", "approval-responded"]);

const sessionTurnMessage = (message: UIMessage | undefined): UIMessage | undefined => {
  if (message?.role !== "assistant") return message;
  const approvals = message.parts.filter(
    (part) => isToolUIPart(part) && part.state === "approval-responded",
  );
  return approvals.length > 0 ? { ...message, parts: approvals } : message;
};

/** Build a compact approval or user-turn body; reject requests over the wire limit. */
export const prepareSessionTurnRequest = ({ messages }: { messages: UIMessage[] }) => {
  const body = { message: sessionTurnMessage(messages.at(-1)) };
  if (jsonBytes(body) > MESSAGE_BODY_LIMIT_BYTES) throw new Error(MESSAGE_SIZE_ERROR);
  return { body };
};

// Rewrite any still-running tool call to a terminal cancelled state. Cancelling
// a turn stops a call mid-flight, which otherwise leaves its part on "working"
// in the transcript; this marks it cancelled instead. Other parts pass through.
// The server persists the cancelled turn the same way (a call still streaming
// its input is dropped there rather than marked — the model never finished
// issuing it — but it stays marked here until the committed snapshot arrives).
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
  /** The turn is currently generating a context checkpoint. */
  compacting: boolean;
  /** A tool call on the latest turn is awaiting the user's Allow / Deny verdict. */
  awaitingApproval: boolean;
  /**
   * Live consoles of the turn's executing tool calls, fed by the stream's
   * transient data parts and cleared when the turn settles. Referentially
   * stable, so passing it to the transcript never defeats the message memo.
   */
  liveConsoles: LiveConsoleStore;
  /** Start a turn from composed parts. */
  sendMessage: ReturnType<typeof useChat<UIMessage>>["sendMessage"];
  /**
   * Queue `text` for the session; the server schedules its delivery. The
   * queue lives server-side (it rides the session detail as `inbox`). Until
   * the server confirms the message it shows in `submitting`, and a submission
   * whose outcome never arrived is repeated under the same id, so it is never
   * queued twice. Rejects when the message was refused or could not be
   * confirmed — the caller still holds the text.
   */
  queueMessage: (text: string) => Promise<void>;
  /** Messages this view has submitted to the queue and not yet had confirmed. */
  submitting: SessionInboxItem[];
  /**
   * Withdraw a queued message before a turn takes it. Delivery wins the race:
   * a message already taken stays in the transcript, and its chip resolves
   * either way.
   */
  withdrawMessage: (itemId: string) => Promise<void>;
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
  /** Revision belonging to initialMessages, including a stream replay baseline. */
  transcriptRevision: number;
}): SessionConversation {
  const { session, initialMessages, transcriptRevision } = opts;
  const sync = useRef({
    id: session.id,
    revision: transcriptRevision,
    generation: 0,
    protected: false,
  });
  if (sync.current.id !== session.id) {
    sync.current = {
      id: session.id,
      revision: transcriptRevision,
      generation: 0,
      protected: false,
    };
  }
  const transcript = sync.current;
  const refreshDetail = useRefreshSessionDetail(session.id);
  const protectTranscript = useCallback(() => {
    transcript.generation += 1;
    transcript.protected = true;
  }, [transcript]);

  const transport = useMemo(() => {
    const { url, headers } = sessionTurnEndpoint(session.id);
    return new DefaultChatTransport<UIMessage>({
      api: url,
      headers,
      // Send only the new message; the server loads the prior turns. Approval
      // resumes need only the verdict-bearing parts — retransmitting earlier
      // tool outputs from the paused turn can exceed the API body limit.
      prepareSendMessagesRequest: (request) => {
        protectTranscript();
        return prepareSessionTurnRequest(request);
      },
      // Resume reconnects to the GET stream endpoint, not the POST turn `api`.
      prepareReconnectToStreamRequest: () => ({ api: sessionStreamEndpoint(session.id) }),
    });
  }, [session.id, protectTranscript]);

  // Live tool consoles for the in-flight turn. One store per mounted engine,
  // cleared on session entry (below) and again when a turn settles, so a
  // session switch or a settled call never shows a stale console.
  const liveConsoles = useMemo(() => createLiveConsoleStore(), []);
  const [compacting, setCompacting] = useState(false);

  const {
    messages,
    sendMessage: sendChatMessage,
    status,
    stop,
    error,
    setMessages,
    addToolApprovalResponse,
    resumeStream,
  } = useChat<UIMessage>({
    id: session.id,
    messages: initialMessages,
    transport,
    onFinish: () => {
      void refreshTranscript();
    },
    // Cap transcript re-renders to ~16/s. A fast provider otherwise delivers
    // deltas quicker than a grown transcript can re-render, and the backlog
    // pins the main thread until the tab freezes; 60 ms still reads as live
    // streaming.
    experimental_throttle: 60,
    // Live progress (an executing command's console) rides the stream as
    // transient data parts: they never join the transcript, so they land in
    // the side store the tool blocks read — only the block showing a console
    // re-renders per snapshot.
    onData: (dataPart) => {
      const compaction = compactionStatusOf(dataPart);
      if (compaction !== null) setCompacting(compaction);
      const update = liveConsoleOf(dataPart);
      if (update !== null) liveConsoles.set(update.toolCallId, update.snapshot);
    },
    // Once every pending tool approval on the latest turn has a verdict, send it
    // straight back so the turn resumes without another user action.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  // A read begun after streaming ended can release local protection. Cached
  // reads begun during the turn may describe only its replay baseline.
  const refreshTranscript = useCallback(async (): Promise<void> => {
    const generation = transcript.generation;
    let detail: Awaited<ReturnType<typeof refreshDetail>>;
    try {
      detail = await refreshDetail();
    } catch {
      // fetchQuery exposes the failure through useSession. Keep local work
      // until a later successful refresh rather than applying an older cache.
      return;
    }
    if (sync.current !== transcript || generation !== transcript.generation) return;
    transcript.protected = false;
    if (detail.transcriptRevision <= transcript.revision) return;
    transcript.revision = detail.transcriptRevision;
    // Cancellation can finish the browser stream before the server settles.
    // Its active replay baseline must not erase the locally rendered tail.
    if (detail.session.status !== "running") setMessages(detail.messages);
  }, [refreshDetail, setMessages, transcript]);

  const sendMessage = useCallback<SessionConversation["sendMessage"]>(
    (...args) => {
      protectTranscript();
      return sendChatMessage(...args);
    },
    [protectTranscript, sendChatMessage],
  );

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
    // A newly-entered session starts with no live consoles; rejoining its
    // in-flight stream below replays any current ones straight back in.
    liveConsoles.clear();
    setCompacting(false);
    void resumeStream();
  }, [session.id, resumeStream, liveConsoles]);

  // `streaming` is this view driving the turn. `busy` is a turn in flight at all
  // — including one started elsewhere, or left running when we navigated away:
  // the session row reports `running` while `useChat` sits idle here.
  const streaming = status === "submitted" || status === "streaming";
  if (streaming) transcript.protected = true;
  const busy = streaming || session.status === "running";

  // Transient progress is turn-scoped: once this view stops streaming, drop it —
  // every call and any compaction have settled (or been cancelled).
  useEffect(() => {
    if (!streaming) {
      liveConsoles.clear();
      setCompacting(false);
    }
  }, [streaming, liveConsoles]);

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

  // The inbox lives server-side; a confirmed message patches the cached
  // detail so it shows at once instead of waiting for the SSE echo's refetch.
  // Until then it is held here, where no refetch can drop it.
  const inboxCache = usePatchSessionInbox(session.id);
  const [submitting, setSubmitting] = useState<SessionInboxItem[]>([]);

  const queueMessage = useCallback(
    async (text: string) => {
      const item: SessionInboxItem = {
        id: crypto.randomUUID(),
        source: "user",
        text,
        fromSessionId: null,
        createdAt: new Date().toISOString(),
      };
      setSubmitting((prev) => [...prev, item]);
      try {
        const result = await submitQueuedMessage(session.id, item.id, text);
        // A repeat can find a turn has already taken the message: it is in
        // the transcript, not the backlog.
        if (!result.delivered) inboxCache.append(result.item);
      } finally {
        setSubmitting((prev) => prev.filter((pending) => pending.id !== item.id));
      }
    },
    [session.id, inboxCache],
  );

  const withdrawMessage = useCallback(
    async (itemId: string) => {
      await withdrawQueuedMessage(session.id, itemId);
      inboxCache.remove(itemId);
    },
    [session.id, inboxCache],
  );

  // Revisions detect replacements and deletions as well as appended content.
  // Never advance the accepted revision while local work owns the transcript.
  useEffect(() => {
    if (streaming || transcript.protected || transcriptRevision <= transcript.revision) return;
    transcript.revision = transcriptRevision;
    setMessages(initialMessages);
  }, [streaming, transcript, transcriptRevision, initialMessages, setMessages]);

  // Resend an edited user message, re-running the conversation from it. Truncate
  // the stored transcript back to the message first (so the turn's server-side
  // append lands at the right index). A newer snapshot or local action may
  // overtake the request; only mirror the cut if it is still current.
  const resubmit = useCallback(
    async (messageId: string, parts: UIMessage["parts"]) => {
      if (busy) return;
      const index = messages.findIndex((message) => message.id === messageId);
      if (index === -1) return;
      const generation = transcript.generation;
      const { transcriptRevision: revision } = await truncateSessionMessages(session.id, messageId);
      if (sync.current !== transcript || generation !== transcript.generation) return;
      if (revision >= transcript.revision) {
        transcript.revision = revision;
        setMessages(messages.slice(0, index));
      }
      void sendMessage({ parts });
    },
    [busy, messages, session.id, setMessages, sendMessage, transcript],
  );

  // Delete a message without resending: truncate the stored transcript from it,
  // mirror the cut into the cached session detail, then drop the local messages
  // from that point. The committed revision prevents an older read from
  // restoring deleted messages. A failed truncate leaves the transcript intact.
  const truncateDetail = useTruncateSessionDetail(session.id);
  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (busy) return;
      const index = messages.findIndex((message) => message.id === messageId);
      if (index === -1) return;
      const generation = transcript.generation;
      const { transcriptRevision: revision } = await truncateSessionMessages(session.id, messageId);
      truncateDetail(messageId, revision);
      if (
        sync.current !== transcript ||
        generation !== transcript.generation ||
        revision < transcript.revision
      )
        return;
      transcript.revision = revision;
      setMessages(messages.slice(0, index));
    },
    [busy, messages, session.id, truncateDetail, setMessages, transcript],
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
      protectTranscript();
      void addToolApprovalResponse({ id: part.approval.id, approved: decision !== "deny" });
    },
    [addToolApprovalResponse, protectTranscript],
  );

  const cancel = useCallback(() => {
    protectTranscript();
    void stop();
    // Best-effort: abort the server turn too. A 404/409 means it already settled.
    void cancelSession(session.id)
      .catch(() => {})
      .then(refreshTranscript);
    // Stopping mid-call leaves the tool part on "working"; mark it cancelled so
    // the transcript reflects the stop rather than spinning forever.
    setMessages(cancelInFlightTools);
  }, [stop, session.id, setMessages, protectTranscript, refreshTranscript]);

  return {
    messages,
    status,
    error,
    streaming,
    busy,
    compacting,
    awaitingApproval,
    liveConsoles,
    sendMessage,
    queueMessage,
    submitting,
    withdrawMessage,
    setMessages,
    resubmit,
    deleteMessage,
    cancel,
    onToolDecision,
  };
}
