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
import { TURN_ID_HEADER } from "../../../shared/api/sessions.ts";
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

// How many times in a row a view re-reads the transcript and rejoins the turn
// whose stream ended under it. A rejoin that keeps ending is not going to
// take; the view then shows the session as busy until the turn settles.
const MAX_REJOINS = 3;

// Tool-call states that mean a call is still running.
const IN_FLIGHT_TOOL_STATES = new Set(["input-streaming", "input-available", "approval-responded"]);

// An answered assistant turn resumes on its verdicts alone, each naming its
// call by id: the server holds the calls themselves, so nothing of the paused
// turn — which can dwarf the API body limit — travels back.
const sessionTurnBody = (message: UIMessage | undefined) => {
  const approvals =
    message?.role === "assistant"
      ? message.parts.flatMap((part) =>
          isToolUIPart(part) && part.state === "approval-responded"
            ? [{ toolCallId: part.toolCallId, approved: part.approval.approved }]
            : [],
        )
      : [];
  return approvals.length > 0 ? { approvals } : { message };
};

/** Build an approval or user-turn body; reject requests over the wire limit. */
export const prepareSessionTurnRequest = ({ messages }: { messages: UIMessage[] }) => {
  const body = sessionTurnBody(messages.at(-1));
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
 * endpoint, joins the stream of any turn it is not already attached to — one
 * in flight as the view mounts, or one the server starts later — reconciles a
 * turn that finished while this view wasn't streaming, and exposes the send /
 * resubmit / cancel / tool-approval handlers. The page chat and the
 * embedded child-session view share this engine; each renders its own chrome
 * around it.
 */
export function useSessionConversation(opts: {
  session: { id: string; status: string };
  /** The persisted transcript to seed once; `useChat` owns the live state after mount. */
  initialMessages: UIMessage[];
  /** Revision belonging to initialMessages, including a stream replay baseline. */
  transcriptRevision: number;
  /** The turn streaming for the session as of that read, or null when none was. */
  turnId: string | null;
}): SessionConversation {
  const { session, initialMessages, transcriptRevision, turnId } = opts;
  const entered = (): {
    id: string;
    revision: number;
    generation: number;
    protected: boolean;
    rejoins: number;
    /** The turn whose stream this view last attached to, or set out to. */
    turnId: string | null;
  } => ({
    id: session.id,
    revision: transcriptRevision,
    generation: 0,
    protected: false,
    rejoins: 0,
    turnId: null,
  });
  const sync = useRef(entered());
  if (sync.current.id !== session.id) sync.current = entered();
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
      // Resume reconnects to the GET stream endpoint, not the POST turn `api`,
      // naming the transcript this view holds: the server replays only what
      // follows that revision, so a rejoin can never duplicate a saved step.
      prepareReconnectToStreamRequest: () => ({
        api: sessionStreamEndpoint(session.id, sync.current.revision),
      }),
      // Every stream this view attaches through names its turn. A rejoin can
      // land on a newer turn than the one it set out for, so the response,
      // not the request, says which turn the view now holds.
      fetch: (async (input, init) => {
        const response = await fetch(input, init);
        const attached = response.headers.get(TURN_ID_HEADER);
        if (attached !== null && sync.current.id === session.id) sync.current.turnId = attached;
        return response;
      }) as typeof fetch,
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
    // A stream this view did not stop may have ended short of the turn.
    onFinish: ({ isAbort }) => {
      void refreshTranscript({ rejoin: !isAbort });
    },
    // Render the growing transcript at most four times a second. Markdown parsing
    // gets more expensive with every delta, while a quarter-second cadence still
    // reads as live; status changes use their own unthrottled subscription.
    experimental_throttle: 250,
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

  // A read begun after streaming ended can release local protection. A turn
  // streaming then is joined from the fresh transcript when it is not the one
  // this view was attached to — a wake that followed straight on. When it is
  // the same turn, the stream ended short of it — this view held a transcript
  // the live stream no longer continues from, or fell too far behind it — and
  // only `rejoin` resumes it.
  const refreshTranscript = useCallback(
    async ({ rejoin = false } = {}): Promise<void> => {
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
      if (detail.turnId !== null) {
        const attached = detail.turnId === transcript.turnId;
        // Cancellation can finish the browser stream before the server settles
        // that same turn: resuming would replay it into a duplicate, and the
        // saved transcript must not erase the locally rendered tail.
        if (attached && (!rejoin || transcript.rejoins >= MAX_REJOINS)) return;
        transcript.rejoins = attached ? transcript.rejoins + 1 : 0;
        transcript.turnId = detail.turnId;
        transcript.revision = detail.transcriptRevision;
        setMessages(detail.messages);
        void resumeStream();
        return;
      }
      transcript.rejoins = 0;
      if (detail.transcriptRevision <= transcript.revision) return;
      transcript.revision = detail.transcriptRevision;
      setMessages(detail.messages);
    },
    [refreshDetail, resumeStream, setMessages, transcript],
  );

  const sendMessage = useCallback<SessionConversation["sendMessage"]>(
    (...args) => {
      protectTranscript();
      return sendChatMessage(...args);
    },
    [protectTranscript, sendChatMessage],
  );

  // A newly-entered session starts with no live consoles; joining its
  // in-flight stream replays any current ones straight back in.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-runs per session entered
  useEffect(() => {
    liveConsoles.clear();
    setCompacting(false);
  }, [session.id, liveConsoles]);

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
  //
  // The same read names the turn streaming for the session. One this view is
  // not attached to — in flight as the view mounts, started in another tab, or
  // a wake the server began — is joined from that transcript, so a page
  // refresh or a second view carries the live response, tokens and tool-call
  // state alike, to completion. The turn is recorded as it is joined, before
  // any response: a second pass over the same read (StrictMode runs effects
  // twice in dev) must not replay the buffer into a duplicate. A turn already
  // attached to is never resumed from here — its stream ending is `onFinish`'s
  // affair — and a read older than the transcript held joins nothing.
  useEffect(() => {
    if (streaming || transcript.protected) return;
    if (transcriptRevision > transcript.revision) {
      transcript.revision = transcriptRevision;
      setMessages(initialMessages);
    }
    if (turnId === null || turnId === transcript.turnId) return;
    if (transcriptRevision < transcript.revision) return;
    transcript.turnId = turnId;
    transcript.rejoins = 0;
    void resumeStream();
  }, [
    streaming,
    transcript,
    transcriptRevision,
    turnId,
    initialMessages,
    setMessages,
    resumeStream,
  ]);

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
      .then(() => refreshTranscript());
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
