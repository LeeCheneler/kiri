import type { UIMessage } from "ai";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";
import { ApiError, type Session, type SessionDetail } from "../../api.ts";
import { Chip } from "../../design-system/actions/chip.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import type { WikiLinkResolver } from "../../design-system/content/wiki-links.ts";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { Status } from "../../design-system/feedback/status.tsx";
import { Breadcrumb } from "../../design-system/navigation/breadcrumb.tsx";
import { useProject } from "../../state/projects.ts";
import { useModels, useSession } from "../../state/sessions.ts";
import { ChatMessage } from "./chat-message.tsx";
import {
  CONTEXT_WARNING_RATIO,
  contextWindowForModel,
  currentContextTokens,
} from "./context-usage.ts";
import { MessageComposer } from "./message-composer.tsx";
import { modelLabel } from "./model-options.ts";
import { useSessionDraft } from "./session-draft.ts";
import { SessionModelControls } from "./session-model-controls.tsx";
import { TidyDraft } from "./tidy-draft.tsx";
import { useSessionConversation } from "./use-session-conversation.ts";
import { useSuggestedReplies } from "./use-suggested-replies.ts";
import { useTidyDraft } from "./use-tidy-draft.ts";

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

// The chat header breadcrumb: a project session threads home through its
// project; a projectless one through the session list.
function ChatBreadcrumb({ session }: { session: Session }) {
  const current = session.title ?? session.id.slice(0, 8);
  if (session.projectId === null) {
    return (
      <Breadcrumb items={[{ label: "Sessions", href: "/?view=sessions" }]} current={current} />
    );
  }
  return <ProjectChatBreadcrumb projectId={session.projectId} current={current} />;
}

// Split out so the project-name query mounts only for project sessions. The
// short project id stands in while the name loads (or if the project query
// errors independently of the session).
function ProjectChatBreadcrumb({ projectId, current }: { projectId: string; current: string }) {
  const name = useProject(projectId).data?.project.name ?? projectId.slice(0, 8);
  return (
    <Breadcrumb
      items={[
        { label: "Projects", href: "/projects" },
        { label: name, href: `/projects/${encodeURIComponent(projectId)}` },
      ]}
      current={current}
    />
  );
}

// A project session's chat also renders the model's `[[slug]]` references as
// corpus links, matching the project reading view — the assistant cross-links
// articles in its replies the same way it does in article bodies. Split so the
// corpus query mounts only for project sessions; a projectless chat has no
// corpus to resolve against, so the syntax stays literal there.
function Chat({ detail }: { detail: SessionDetail }) {
  const { projectId } = detail.session;
  if (projectId === null) return <ChatView detail={detail} />;
  return <ProjectChat detail={detail} projectId={projectId} />;
}

function ProjectChat({ detail, projectId }: { detail: SessionDetail; projectId: string }) {
  // `[[slug]]` references resolve against the corpus index, linking by the
  // target's title. Memoised so the ChatMessage memo holds between renders;
  // unresolved slugs (and everything until the index loads) stay literal.
  const corpus = useProject(projectId).data?.articles;
  const wikiLinkResolver = useMemo<WikiLinkResolver>(() => {
    const targets = new Map(
      (corpus ?? []).map((entry) => [
        entry.slug,
        {
          href: `/projects/${encodeURIComponent(projectId)}/articles/${encodeURIComponent(entry.slug)}`,
          label: entry.heading ?? entry.name,
        },
      ]),
    );
    return (slug) => targets.get(slug) ?? null;
  }, [corpus, projectId]);
  return <ChatView detail={detail} wikiLinkResolver={wikiLinkResolver} />;
}

function ChatView({
  detail,
  wikiLinkResolver,
}: {
  detail: SessionDetail;
  wikiLinkResolver?: WikiLinkResolver;
}) {
  const { session } = detail;
  const modelsData = useModels().data;
  const models = modelsData?.models ?? [];
  // Whether the session's model reads images, per its provider's listing. Only
  // a definite "no" restricts the composer — unknown (a bare listing, a pinned
  // model the provider no longer lists) keeps images attachable rather than
  // blocking on a guess.
  const acceptsImages = models.find((model) => model.id === session.model)?.imageInput !== false;

  // Seed once from the persisted transcript; `useChat` owns the live state from
  // here. A later refetch (from a session.* event) re-runs this memo, but
  // `useChat` ignores the prop after mount, so the live transcript is unaffected.
  const initialMessages = useMemo<UIMessage[]>(
    () => detail.messages.map((m) => ({ id: m.id, role: m.role, parts: m.parts })),
    [detail.messages],
  );
  const {
    messages,
    error,
    busy,
    awaitingApproval,
    sendMessage,
    resubmit,
    deleteMessage,
    cancel,
    onToolDecision,
  } = useSessionConversation({ session, initialMessages });
  // Chips above the composer for a settled turn a short reply answers. Driven
  // by the persisted transcript rather than the live one: it refetches in the
  // same query as the `busy` status, so a settled turn's suggestions are only
  // asked for once its message is stored.
  const suggestedReplies = useSuggestedReplies({
    sessionId: session.id,
    messages: detail.messages,
    busy,
    awaitingApproval,
  });
  const { draft, setDraft, clearDraft } = useSessionDraft(session.id);
  const tidyState = useTidyDraft({ value: draft, onChange: setDraft });
  const inputId = useId();

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
  // message; the user un-pins by scrolling up, and `send` re-pins for the next
  // turn. `lastScrollTop` is the offset we last saw, to read a scroll's direction.
  const pinnedToBottom = useRef(true);
  const lastScrollTop = useRef(0);
  useEffect(() => {
    // Seed from where the page actually sits: a session with no messages never
    // runs the follow below, so nothing else would, and the first scroll away
    // from a non-zero offset would read as downward.
    lastScrollTop.current = document.documentElement.scrollTop;
    const onScroll = () => {
      // Following the foot only ever scrolls *down*, so any upward movement is
      // the user taking over — a wheel notch, a trackpad nudge, a scrollbar drag.
      // Un-pin on the first pixel of it: a threshold would have to be re-cleared
      // against every streamed delta yanking the page back, so escaping the foot
      // mid-stream would mean out-scrolling the model.
      const { scrollTop } = document.documentElement;
      if (scrollTop < lastScrollTop.current) pinnedToBottom.current = false;
      lastScrollTop.current = scrollTop;
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
  // it snaps rather than animating.
  //
  // Recording where we landed keeps the scroll event this fires from reading as
  // the user: sending a tall draft collapses the composer, so the page can shrink
  // and leave the foot *above* the offset we last saw. Both writes land before
  // paint, and the browser coalesces the frame's scroll events into one, so the
  // listener only ever sees the settled offset.
  useLayoutEffect(() => {
    if (messages.length === 0 || !pinnedToBottom.current) return;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
    lastScrollTop.current = document.documentElement.scrollTop;
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

  // Resend an edited user message via the conversation engine, pulling the
  // transcript back to the foot for the re-run turn. `resubmit` re-derives on
  // every streamed delta (it closes over the live transcript), so passing it
  // straight down would defeat `ChatMessage`'s memo; route it through a ref —
  // the latest-closure pattern the live events provider uses — so every
  // message receives one stable handler that always calls the current engine.
  const resubmitRef = useRef(resubmit);
  resubmitRef.current = resubmit;
  const handleResubmit = useCallback(async (messageId: string, parts: UIMessage["parts"]) => {
    pinnedToBottom.current = true;
    await resubmitRef.current(messageId, parts);
  }, []);

  // Delete a user message (and the turns after it) via the conversation engine,
  // routed through a ref for the same stable-handler reason as resubmit.
  const deleteMessageRef = useRef(deleteMessage);
  deleteMessageRef.current = deleteMessage;
  const handleDeleteMessage = useCallback(async (messageId: string) => {
    await deleteMessageRef.current(messageId);
  }, []);

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
        <ChatBreadcrumb session={session} />
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
              sessionId={session.id}
              wikiLinkResolver={wikiLinkResolver}
              onResubmit={handleResubmit}
              onDelete={handleDeleteMessage}
              onToolDecision={onToolDecision}
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
              model in the composer and resend.
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
        {/* Tap-to-send replies for the settled turn above — tapping one sends
            it as an ordinary user message through the same path as the
            composer, and the row hides the moment a turn is in flight. */}
        {suggestedReplies.length > 0 ? (
          /* A fieldset for the group semantics; the flex row lives on an inner
             div because browsers don't lay fieldsets out as flex containers. */
          <fieldset className="mb-4" aria-label="Suggested replies">
            <div className="flex flex-wrap gap-2">
              {suggestedReplies.map((reply) => (
                <Chip key={reply} onClick={() => handleSend([{ type: "text", text: reply }])}>
                  {reply}
                </Chip>
              ))}
            </div>
          </fieldset>
        ) : null}
        {/* Keyed by session so switching sessions remounts a fresh composer,
            clearing any staged images (the draft text is per-session already).
            Enter-only submit — the key instructions ride in the placeholder,
            visible exactly when there's nothing typed to send. */}
        {/* The tidy shortcut listens on a wrapper rather than the composer's
            own key handling, so the composer primitive stays unaware of it. */}
        <div
          onKeyDown={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              event.shiftKey &&
              event.key.toLowerCase() === "f"
            ) {
              event.preventDefault();
              tidyState.tidy();
            }
          }}
        >
          <MessageComposer
            key={session.id}
            id={inputId}
            label="Message"
            labelHidden
            value={draft}
            onChange={setDraft}
            placeholder="Send a message… enter to send · shift+enter for newline"
            busy={busy || awaitingApproval}
            acceptsImages={acceptsImages}
            controls={
              <>
                <TidyDraft state={tidyState} empty={draft.trim() === ""} />
                <SessionModelControls id={session.id} />
              </>
            }
            onSubmit={handleSend}
          />
        </div>
        {/* A quiet readout of what the next turn runs with, labelled the way
            the picker labels it — the shortcut's name when one points at the
            session's model. */}
        <div className="mt-2 flex justify-end">
          <Meta>
            <span>{modelLabel(modelsData?.shortcuts?.text, session.model)}</span>
            <span>{session.effort}</span>
          </Meta>
        </div>
      </div>
    </section>
  );
}
