import type { UIMessage } from "ai";
import { useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";
import { INVESTIGATE_TOOL_NAME } from "../../../shared/investigate.ts";
import { ApiError, type SessionDetail } from "../../api.ts";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { Status } from "../../design-system/feedback/status.tsx";
import { Breadcrumb } from "../../design-system/navigation/breadcrumb.tsx";
import { useModels, useSession } from "../../state/sessions.ts";
import { ChatMessage } from "./chat-message.tsx";
import {
  CONTEXT_WARNING_RATIO,
  contextWindowForModel,
  currentContextTokens,
} from "./context-usage.ts";
import { MessageComposer } from "./message-composer.tsx";
import { useSessionDraft } from "./session-draft.ts";
import { useSessionConversation } from "./use-session-conversation.ts";

// The session row stores a terminal turn's failure as `{ message }`. Pull that
// out so a turn that failed while this view was away still surfaces its error on
// return — where `useChat`'s own `error`, set only for a turn driven from here,
// is empty.
function sessionErrorText(error: unknown): string | undefined {
  if (error && typeof error === "object" && "message" in error) {
    const { message } = error as { message: unknown };
    return typeof message === "string" ? message : undefined;
  }
  return undefined;
}

// Whether a message carries an image attachment — used to nudge towards a
// multimodal model when a turn that included one fails (the likeliest cause).
function messageHasImage(message: UIMessage): boolean {
  return message.parts.some((part) => part.type === "file" && part.mediaType.startsWith("image/"));
}

// How close to the transcript foot still counts as "pinned" to it. A little
// slack absorbs sub-pixel rounding so a user sitting at the bottom isn't read as
// having scrolled away.
const PIN_SLACK_PX = 64;

// Whether the page is scrolled to (near) the foot of the transcript. We follow a
// streaming reply only while pinned; once the user scrolls up past the slack
// they've taken over, so we leave their position be until the next turn.
function isPinnedToBottom(): boolean {
  const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
  return scrollHeight - scrollTop - clientHeight <= PIN_SLACK_PX;
}

/**
 * Session chat route content. Loads the session (its model, running token total,
 * and persisted transcript), then hands off to the live chat once it has
 * settled, so `useChat` is seeded with the stored messages exactly once.
 */
export function SessionChat({ id }: { id: string }) {
  const session = useSession(id);

  if (session.isPending) return <LoadingState>Loading session…</LoadingState>;
  if (session.isError) {
    const notFound = session.error instanceof ApiError && session.error.status === 404;
    return (
      <section>
        <Breadcrumb
          items={[{ label: "Sessions", href: "/?view=sessions" }]}
          current={notFound ? "Not found" : "Error"}
        />
        <p role="alert" className="mt-6 font-mono text-sm text-status-failed">
          {notFound
            ? `No session with id ${id}.`
            : `Failed to load session: ${session.error.message}`}
        </p>
      </section>
    );
  }

  return <Chat detail={session.data} />;
}

function Chat({ detail }: { detail: SessionDetail }) {
  const { session } = detail;
  const models = useModels().data?.models ?? [];

  // Seed once from the persisted transcript; `useChat` owns the live state from
  // here. A later refetch (from a session.* event) re-runs this memo, but
  // `useChat` ignores the prop after mount, so the live transcript is unaffected.
  const initialMessages = useMemo<UIMessage[]>(
    () => detail.messages.map((m) => ({ id: m.id, role: m.role, parts: m.parts })),
    [detail.messages],
  );
  // The live conversation engine: the page renders its own chrome (header,
  // composer, context warning, scroll) around it. `busy` covers a turn in flight
  // here or elsewhere; `awaitingApproval` blocks a new message until a paused
  // tool call is resolved.
  const {
    messages,
    error,
    busy,
    awaitingApproval,
    sendMessage,
    resubmit,
    cancel,
    onToolDecision,
    addToolOutput,
  } = useSessionConversation({ session, initialMessages });
  const { draft, setDraft, clearDraft } = useSessionDraft(session.id);
  const inputId = useId();

  // Wiring for any investigate tool call in the transcript: the box runs the
  // child against this session and reports back here, supplying the call's output
  // so the paused turn resumes.
  const investigation = useMemo(
    () => ({
      parentSessionId: session.id,
      onReport: (toolCallId: string, report: string) =>
        addToolOutput({ tool: INVESTIGATE_TOOL_NAME, toolCallId, output: report }),
    }),
    [session.id, addToolOutput],
  );
  // A failure to surface at the transcript foot: this view's own turn errored,
  // or — on revisit — the row records a turn that failed while we were away.
  const failed = !busy && (error != null || session.status === "failed");
  const failureText = error?.message ?? sessionErrorText(session.error);
  // A turn that carried an image and failed most likely hit a text-only model;
  // nudge towards switching models rather than reading the provider's error.
  const failedWithImage = useMemo(() => {
    if (!failed) return false;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    return lastUser ? messageHasImage(lastUser) : false;
  }, [failed, messages]);

  // Warn as the conversation nears the model's context window: the live fill from
  // the last settled turn against the catalogued limit. Absent until a turn has
  // settled and only when the model's window is known.
  const contextTokens = currentContextTokens(detail.messages);
  const contextLimit = contextWindowForModel(models, session.model);
  const contextWarning =
    contextTokens !== undefined &&
    contextLimit !== undefined &&
    contextTokens / contextLimit >= CONTEXT_WARNING_RATIO
      ? { tokens: contextTokens, limit: contextLimit }
      : undefined;

  // Whether the transcript foot is "pinned" to the viewport bottom — we only
  // follow new content while it is. Starts pinned so landing snaps to the latest
  // message; the user un-pins by scrolling up mid-stream, and `send` re-pins for
  // the next turn.
  const pinnedToBottom = useRef(true);
  useEffect(() => {
    const onScroll = () => {
      pinnedToBottom.current = isPinnedToBottom();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Keep the foot of the transcript in view while pinned: on landing (the seeded
  // history), as messages are added, and through the assistant's streamed reply —
  // `useChat` hands back a fresh `messages` array on each delta, so this re-pins
  // the whole turn. The page scrolls behind the sticky composer, so we drive the
  // window. A layout effect lands at the foot before paint (no flash of the top),
  // and `behavior: "instant"` opts out of the document's smooth scroll-behavior:
  // it snaps rather than animating, and so fires no intermediate scroll events
  // that would read as the user scrolling away.
  useLayoutEffect(() => {
    if (messages.length === 0 || !pinnedToBottom.current) return;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
  }, [messages]);

  // Focus the composer on landing so a message can be typed straight away.
  // `Chat` only mounts once the session has loaded, so this fires when the page
  // has settled rather than mid-load.
  useEffect(() => {
    document.getElementById(inputId)?.focus();
  }, [inputId]);

  // Send a composed turn. The composer assembles the parts (text + any staged
  // images); a new turn pulls the transcript back to the foot, even if the user
  // had scrolled up to read the previous reply.
  const handleSend = (parts: UIMessage["parts"]) => {
    pinnedToBottom.current = true;
    void sendMessage({ parts });
    clearDraft();
  };

  // Resend an edited user message: re-pin to the foot, then let the conversation
  // engine truncate the transcript back to it and re-run from there.
  const handleResubmit = (messageId: string, parts: UIMessage["parts"]) => {
    pinnedToBottom.current = true;
    return resubmit(messageId, parts);
  };

  // Esc cancels an in-flight turn. The composer has no `onCancel` in this view,
  // so it leaves Escape alone; catch it on the window while a turn is busy.
  useEffect(() => {
    if (!busy) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, cancel]);

  return (
    <section>
      {/* Sticky header: pulled up over the shell's top padding (then restored as
          inner padding) so it pins flush to the top with breathing room, mirroring
          the sticky composer at the foot. The transcript scrolls behind it. */}
      <div className="sticky top-0 z-10 -mt-6 border-b border-rule bg-canvas pt-6 pb-4 lg:-mt-8 lg:pt-8">
        <Breadcrumb
          items={[{ label: "Sessions", href: "/?view=sessions" }]}
          current={session.id.slice(0, 8)}
        />
      </div>

      <div className="mt-8 space-y-8">
        {messages.length === 0 ? (
          <EmptyState>No messages yet. Send one to start the conversation.</EmptyState>
        ) : (
          messages.map((message) => (
            <ChatMessage
              key={message.id}
              message={message}
              busy={busy}
              onResubmit={handleResubmit}
              onToolDecision={onToolDecision}
              onCancel={busy ? cancel : undefined}
              investigation={investigation}
            />
          ))
        )}
      </div>

      {/* In-flight / failed cue at the transcript foot, above the composer rule:
          the working (or failed) status, with the cancel hint alongside while a
          turn streams; a failed turn shows the provider's message instead. */}
      {busy || failed ? (
        <div className="mt-8 font-mono text-xs">
          <div className="flex items-baseline gap-3">
            <Status status={busy ? "working" : "failed"} />
            {busy ? <span className="text-ink-muted">Escape to cancel</span> : null}
          </div>
          {failed ? (
            <p role="alert" className="mt-1 font-mono text-sm text-status-failed">
              {failureText}
            </p>
          ) : null}
          {failedWithImage ? (
            <p className="mt-1 text-ink-muted">
              This turn included an image. If the model can't read images, switch to a multimodal
              model in the panel and resend.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="sticky bottom-0 mt-8 border-t border-rule bg-canvas pt-4 pb-6">
        {/* Context-limit warning pinned above the input so it stays in view as
            the conversation approaches the model's window. */}
        {contextWarning ? (
          <div className="mb-4">
            <Notice tone="warning" announce="polite" title="Approaching context limit">
              {`${contextWarning.tokens.toLocaleString("en")} of ${contextWarning.limit.toLocaleString(
                "en",
              )} tokens used — start a new session soon to avoid hitting the model's context window.`}
            </Notice>
          </div>
        ) : null}
        {/* Keyed by session so switching sessions remounts a fresh composer,
            clearing any staged images (the draft text is per-session already). */}
        <MessageComposer
          key={session.id}
          id={inputId}
          label="Message"
          value={draft}
          onChange={setDraft}
          placeholder="Send a message…"
          busy={busy || awaitingApproval}
          onSubmit={handleSend}
          hint="Enter to send · Shift + Enter for newline"
        />
      </div>
    </section>
  );
}
