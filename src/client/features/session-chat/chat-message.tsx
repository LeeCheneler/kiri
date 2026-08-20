import type { FileUIPart, UIMessage } from "ai";
import { memo, useEffect, useId, useState } from "react";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { Markdown } from "../../design-system/content/markdown.tsx";
import type { WikiLinkResolver } from "../../design-system/content/wiki-links.ts";
import { Card } from "../../design-system/surfaces/card.tsx";
import { ConfirmModal } from "../../design-system/surfaces/confirm-modal.tsx";
import { type PendingImage, type PendingTextFile, parseAttachedFile } from "./attachments.ts";
import { ChildSession } from "./child-session.tsx";
import { PreviewableFile } from "./file-thumb.tsx";
import { PreviewableImage } from "./image-thumb.tsx";
import type { LiveConsoleStore } from "./live-console.ts";
import { MessageComposer } from "./message-composer.tsx";
import { type Segment, ToolChain, segmentParts } from "./tool-chain.tsx";
import {
  type ToolDecisionHandler,
  ToolInvocation,
  type ToolPageLinks,
} from "./tool-invocation.tsx";

/** Resend an edited user message, re-running the conversation from that point. */
export type ResubmitHandler = (messageId: string, parts: UIMessage["parts"]) => void;

/** Delete a user message — and everything after it — from the conversation. */
export type DeleteMessageHandler = (messageId: string) => void;

// Join the message's typed text parts. Non-text parts (tool calls, files) and
// attached-file text parts are skipped here — images render as thumbnails and
// attached files as chips (below), both above the text.
const messageText = (message: UIMessage): string =>
  message.parts
    .map((part) => (part.type === "text" && parseAttachedFile(part.text) === null ? part.text : ""))
    .join("");

// The image attachments on a message, rendered as thumbnails above its text.
const imageParts = (message: UIMessage): FileUIPart[] =>
  message.parts.filter(
    (part): part is FileUIPart => part.type === "file" && part.mediaType.startsWith("image/"),
  );

// The text files attached to a message, rendered as previewable tiles above its
// text. They ride as `<attached-file>` text parts so they reach the model as
// plain text.
const attachedFiles = (message: UIMessage): { filename: string; content: string }[] =>
  message.parts.flatMap((part) => {
    if (part.type !== "text") return [];
    const parsed = parseAttachedFile(part.text);
    return parsed ? [parsed] : [];
  });

// A user message: image thumbnails above its text, the text rendered verbatim
// (whitespace preserved) since it's exactly what the user typed. Boxed in a card
// so the user's turn reads as visually distinct from the assistant's open prose,
// with corner controls to edit or delete it. Editing swaps the body for the
// shared composer (seeded with this turn's text and images); resending discards
// this turn and everything after it and re-runs from here. Deleting confirms
// in-app first, then discards this turn and everything after it outright.
function UserMessage({
  message,
  busy,
  onResubmit,
  onDelete,
}: {
  message: UIMessage;
  busy: boolean;
  onResubmit: ResubmitHandler;
  onDelete: DeleteMessageHandler;
}) {
  const text = messageText(message);
  const images = imageParts(message);
  const files = attachedFiles(message);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState(text);
  const fieldId = useId();

  // Focus the editor (caret at the end) when it opens, so the message can be
  // amended straight away. Imperative rather than `autoFocus` to satisfy the
  // a11y lint, mirroring the composer's focus-on-ready.
  useEffect(() => {
    if (!editing) return;
    const el = document.getElementById(fieldId);
    if (!(el instanceof HTMLTextAreaElement)) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing, fieldId]);

  const startEditing = () => {
    setDraft(text);
    setEditing(true);
  };

  return (
    <article className="relative">
      <Card>
        {editing ? (
          // The composer's "Edit message" label stands in for the "You" eyebrow
          // while editing, so the card isn't headed by two stacked labels.
          <MessageComposer
            id={fieldId}
            label="Edit message"
            value={draft}
            onChange={setDraft}
            busy={busy}
            initialImages={images.map((part) => ({ id: part.url, part }) satisfies PendingImage)}
            initialTextFiles={files.map(
              (file, index) =>
                ({ id: `${message.id}-file-${index}`, ...file }) satisfies PendingTextFile,
            )}
            onSubmit={(parts) => onResubmit(message.id, parts)}
            onCancel={() => setEditing(false)}
            submitLabel="resend"
          />
        ) : (
          <>
            <Eyebrow tone="muted">You</Eyebrow>
            <div className="mt-2 space-y-3">
              {images.length > 0 || files.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {images.map((part) => (
                    <li key={part.url}>
                      <PreviewableImage part={part} />
                    </li>
                  ))}
                  {files.map((file, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: attached files are fixed on a sent message and never reorder, so the index is a stable key.
                    <li key={index}>
                      <PreviewableFile filename={file.filename} content={file.content} />
                    </li>
                  ))}
                </ul>
              ) : null}
              {text !== "" ? (
                <p className="whitespace-pre-wrap font-mono text-sm text-ink">{text}</p>
              ) : null}
            </div>
          </>
        )}
      </Card>
      {editing ? null : (
        <div className="absolute top-3 right-3 flex items-center gap-3">
          <button
            type="button"
            onClick={startEditing}
            disabled={busy}
            title="Edit message"
            className="cursor-pointer font-mono text-ink-muted text-xs hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            edit
          </button>
          {/* A quiet control that only shows its red on approach, like the
              rail's delete-session action. */}
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            disabled={busy}
            title="Delete message"
            className="cursor-pointer font-mono text-ink-muted text-xs hover:text-status-failed disabled:cursor-not-allowed disabled:opacity-50"
          >
            delete
          </button>
        </div>
      )}
      {confirmingDelete ? (
        <ConfirmModal
          title="Delete this message?"
          body="This removes the message and every turn after it. This cannot be undone."
          confirmLabel="delete"
          variant="negative"
          onConfirm={() => {
            setConfirmingDelete(false);
            onDelete(message.id);
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      ) : null}
    </article>
  );
}

// An assistant message: its segments rendered in order so tool activity sits
// inline with the prose — a lead-in line, the tool block, then the answer that
// follows. Text renders as markdown; a lone tool call renders as a collapsible
// tool block and a run of consecutive calls folds into a single chain panel; a
// call awaiting the user's decision renders an Allow / Always allow / Deny
// prompt, never folded away — nor is a settled generated image, which renders
// its thumbnail below the call.
function AssistantMessage({
  segments,
  sessionId,
  pageLinks,
  liveConsoles,
  wikiLinkResolver,
  onToolDecision,
}: {
  segments: Segment[];
  sessionId?: string;
  pageLinks?: ToolPageLinks;
  liveConsoles?: LiveConsoleStore;
  wikiLinkResolver?: WikiLinkResolver;
  onToolDecision?: ToolDecisionHandler;
}) {
  return (
    <article>
      <Eyebrow tone="accent">Assistant</Eyebrow>
      <div className="mt-2 space-y-3">
        {segments.map((segment) => {
          if (segment.kind === "text") {
            return (
              <Markdown
                key={segment.index}
                content={segment.text}
                wikiLinkResolver={wikiLinkResolver}
              />
            );
          }
          if (segment.kind === "approval") {
            return (
              <ToolInvocation
                key={segment.part.toolCallId}
                part={segment.part}
                onDecision={onToolDecision}
              />
            );
          }
          // A delegate call renders as its embedded child session — the box
          // needs the owning session to find the child, so it degrades to a
          // plain tool block in a context that doesn't supply one.
          if (segment.kind === "delegate") {
            return sessionId ? (
              <ChildSession
                key={segment.part.toolCallId}
                part={segment.part}
                parentSessionId={sessionId}
              />
            ) : (
              <ToolInvocation key={segment.part.toolCallId} part={segment.part} />
            );
          }
          if (segment.kind === "image") {
            return <ToolInvocation key={segment.part.toolCallId} part={segment.part} />;
          }
          return segment.parts.length === 1 ? (
            <ToolInvocation
              key={segment.parts[0].toolCallId}
              part={segment.parts[0]}
              pageLinks={pageLinks}
              liveConsoles={liveConsoles}
            />
          ) : (
            <ToolChain
              key={segment.parts[0].toolCallId}
              parts={segment.parts}
              pageLinks={pageLinks}
              liveConsoles={liveConsoles}
            />
          );
        })}
      </div>
    </article>
  );
}

/**
 * One chat message. A user message renders its text verbatim with any image
 * attachments as thumbnails, boxed in a card with edit and delete controls —
 * editing and resending it (`onResubmit`) re-runs the conversation from that
 * point, while deleting it (`onDelete`, behind an in-app confirm) drops it and
 * everything after it without re-running. An
 * assistant message renders its parts in order — markdown prose interleaved with
 * collapsible tool-call blocks, with a run of consecutive calls folded into one
 * collapsible chain panel. Labelled with who spoke so the transcript reads as a
 * conversation. A just-submitted assistant turn, still awaiting its first
 * chunk, renders nothing. `busy` disables editing while a turn is in flight.
 *
 * Memoised: a streamed delta replaces only the streaming message's object, so
 * every settled message skips re-rendering (and re-parsing its markdown)
 * throughout the turn. Callers must pass referentially stable handlers (and a
 * stable `wikiLinkResolver`) or the memo never holds.
 */
export const ChatMessage = memo(function ChatMessage({
  message,
  busy,
  sessionId,
  pageLinks,
  liveConsoles,
  wikiLinkResolver,
  onResubmit,
  onDelete,
  onToolDecision,
}: {
  message: UIMessage;
  busy: boolean;
  /** The owning session; lets a delegate call render its embedded child session. */
  sessionId?: string;
  /** Where the session's article, memory, and project pages live; tool results link through it. */
  pageLinks?: ToolPageLinks;
  /** Where an executing command's live console snapshots land; must be referentially stable. */
  liveConsoles?: LiveConsoleStore;
  /** Turns `[[slug]]` references in assistant prose into corpus links when set. */
  wikiLinkResolver?: WikiLinkResolver;
  onResubmit: ResubmitHandler;
  onDelete: DeleteMessageHandler;
  onToolDecision?: ToolDecisionHandler;
}) {
  if (message.role === "user")
    return (
      <UserMessage message={message} busy={busy} onResubmit={onResubmit} onDelete={onDelete} />
    );
  const segments = segmentParts(message.parts);
  if (segments.length === 0) return null;
  return (
    <AssistantMessage
      segments={segments}
      sessionId={sessionId}
      pageLinks={pageLinks}
      liveConsoles={liveConsoles}
      wikiLinkResolver={wikiLinkResolver}
      onToolDecision={onToolDecision}
    />
  );
});
