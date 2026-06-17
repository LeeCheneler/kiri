import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ApiError, type SessionDetail, cancelSession, sessionTurnEndpoint } from "../../api.ts";
import { Textarea } from "../../design-system/actions/textarea.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Status } from "../../design-system/feedback/status.tsx";
import { Breadcrumb } from "../../design-system/navigation/breadcrumb.tsx";
import { useSession } from "../../state/sessions.ts";
import { ChatMessage } from "./chat-message.tsx";

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

  // Seed once from the persisted transcript; `useChat` owns the live state from
  // here. A later refetch (from a session.* event) re-runs this memo, but
  // `useChat` ignores the prop after mount, so the live transcript is unaffected.
  const initialMessages = useMemo<UIMessage[]>(
    () => detail.messages.map((m) => ({ id: m.id, role: m.role, parts: m.parts })),
    [detail.messages],
  );
  const transport = useMemo(() => {
    const { url, headers } = sessionTurnEndpoint(session.id);
    return new DefaultChatTransport<UIMessage>({
      api: url,
      headers,
      // Send only the new message; the server loads the prior turns.
      prepareSendMessagesRequest: ({ messages }) => ({ body: { message: messages.at(-1) } }),
    });
  }, [session.id]);

  const { messages, sendMessage, status, stop, error, setMessages } = useChat({
    id: session.id,
    messages: initialMessages,
    transport,
  });
  const [input, setInput] = useState("");
  const inputId = useId();
  // `streaming` is this view driving the turn. `busy` is a turn in flight at all
  // — including one started elsewhere, or left running when we navigated away:
  // the session row reports `running` while `useChat` sits idle here.
  const streaming = status === "submitted" || status === "streaming";
  const busy = streaming || session.status === "running";
  // A failure to surface at the transcript foot: this view's own turn errored,
  // or — on revisit — the row records a turn that failed while we were away.
  const failed = !busy && (error != null || session.status === "failed");
  const failureText = error?.message ?? sessionErrorText(session.error);

  // Keep the foot of the transcript in view: on landing (the seeded history),
  // as messages are added, and through the assistant's streamed reply — `useChat`
  // hands back a fresh `messages` array on each delta, so this re-pins the whole
  // turn. The page itself scrolls behind the sticky composer, so we drive the
  // window; a layout effect lands at the bottom without a flash of the top first.
  useLayoutEffect(() => {
    if (messages.length === 0) return;
    window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [messages]);

  // Focus the composer on landing so a message can be typed straight away.
  // `Chat` only mounts once the session has loaded, so this fires when the page
  // has settled rather than mid-load.
  useEffect(() => {
    document.getElementById(inputId)?.focus();
  }, [inputId]);

  // Also return focus to the composer once a turn settles (the field disables
  // while busy, dropping focus), so the next message follows straight on. Only
  // on the falling edge of `busy`, so a streamed delta mid-turn doesn't grab it.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) document.getElementById(inputId)?.focus();
    wasBusy.current = busy;
  }, [busy, inputId]);

  // A turn can finish while this view is unmounted (we navigated away) or be
  // driven from elsewhere: it persists without `useChat` — which ignores
  // re-seeds after mount — ever seeing it. When we're not the one streaming and
  // the stored transcript has pulled ahead, fold it in so the finished turn
  // shows up here.
  useEffect(() => {
    if (streaming) return;
    if (initialMessages.length > messages.length) setMessages(initialMessages);
  }, [streaming, initialMessages, messages.length, setMessages]);

  const send = () => {
    const text = input.trim();
    if (busy || text === "") return;
    void sendMessage({ text });
    setInput("");
  };
  const cancel = useCallback(() => {
    void stop();
    // Best-effort: abort the server turn too. A 404/409 means it already settled.
    void cancelSession(session.id).catch(() => {});
  }, [stop, session.id]);

  // Esc cancels an in-flight turn. The composer is disabled mid-turn so it
  // can't catch the key itself; listen on the window while a turn is busy.
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
          messages.map((message) => <ChatMessage key={message.id} message={message} />)
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
        </div>
      ) : null}

      <div className="sticky bottom-0 mt-8 border-t border-rule bg-canvas pt-4 pb-6">
        <Textarea
          id={inputId}
          label="Message"
          value={input}
          onChange={setInput}
          placeholder="Send a message…  (Enter to send, Shift + Enter for newline)"
          disabled={busy}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
      </div>
    </section>
  );
}
