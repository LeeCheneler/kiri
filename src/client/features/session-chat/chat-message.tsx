import { type FileUIPart, type UIMessage, isToolUIPart } from "ai";
import { useEffect, useId, useState } from "react";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { Markdown } from "../../design-system/content/markdown.tsx";
import { Card } from "../../design-system/surfaces/card.tsx";
import { type PendingImage, type PendingTextFile, parseAttachedFile } from "./attachments.ts";
import { PreviewableFile } from "./file-thumb.tsx";
import { PreviewableImage } from "./image-thumb.tsx";
import { MessageComposer } from "./message-composer.tsx";
import { type ToolDecisionHandler, ToolInvocation } from "./tool-invocation.tsx";

/** Resend an edited user message, re-running the conversation from that point. */
export type ResubmitHandler = (messageId: string, parts: UIMessage["parts"]) => void;

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

// Whether an assistant message has anything worth rendering yet: non-empty text
// or a tool call. A just-submitted turn has neither until its first chunk lands.
const hasAssistantContent = (message: UIMessage): boolean =>
  message.parts.some((part) => (part.type === "text" && part.text !== "") || isToolUIPart(part));

// A user message: image thumbnails above its text, the text rendered verbatim
// (whitespace preserved) since it's exactly what the user typed. Boxed in a card
// so the user's turn reads as visually distinct from the assistant's open prose,
// with a corner control to edit it. Editing swaps the body for the shared
// composer (seeded with this turn's text and images); resending discards this
// turn and everything after it and re-runs from here.
function UserMessage({
  message,
  busy,
  onResubmit,
}: {
  message: UIMessage;
  busy: boolean;
  onResubmit: ResubmitHandler;
}) {
  const text = messageText(message);
  const images = imageParts(message);
  const files = attachedFiles(message);
  const [editing, setEditing] = useState(false);
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
            hint="Enter to resend · Escape to cancel"
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
        <button
          type="button"
          onClick={startEditing}
          disabled={busy}
          title="Edit message"
          className="absolute top-3 right-3 cursor-pointer font-mono text-ink-muted text-xs hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          edit
        </button>
      )}
    </article>
  );
}

// An assistant message: its parts rendered in order so tool calls sit inline
// with the prose — a lead-in line, the tool block, then the answer that follows.
// Text renders as markdown; tool calls render as collapsible tool blocks, or an
// Allow / Always allow / Deny prompt while one awaits the user's decision.
function AssistantMessage({
  message,
  onToolDecision,
  onCancel,
}: {
  message: UIMessage;
  onToolDecision?: ToolDecisionHandler;
  onCancel?: () => void;
}) {
  return (
    <article>
      <Eyebrow tone="accent">Assistant</Eyebrow>
      <div className="mt-2 space-y-3">
        {message.parts.map((part, index) => {
          if (part.type === "text" && part.text !== "") {
            // biome-ignore lint/suspicious/noArrayIndexKey: assistant parts are append-only within a turn and never reorder, so the index is a stable key.
            return <Markdown key={index} content={part.text} />;
          }
          if (isToolUIPart(part))
            return (
              <ToolInvocation
                key={part.toolCallId}
                part={part}
                onDecision={onToolDecision}
                onCancel={onCancel}
              />
            );
          return null;
        })}
      </div>
    </article>
  );
}

/**
 * One chat message. A user message renders its text verbatim with any image
 * attachments as thumbnails, boxed in a card with an edit control — editing and
 * resending it (`onResubmit`) re-runs the conversation from that point. An
 * assistant message renders its parts in order — markdown prose interleaved with
 * collapsible tool-call blocks. Labelled with who spoke so the transcript reads
 * as a conversation. A just-submitted assistant turn, still awaiting its first
 * chunk, renders nothing. `busy` disables editing while a turn is in flight.
 */
export function ChatMessage({
  message,
  busy,
  onResubmit,
  onToolDecision,
  onCancel,
}: {
  message: UIMessage;
  busy: boolean;
  onResubmit: ResubmitHandler;
  onToolDecision?: ToolDecisionHandler;
  onCancel?: () => void;
}) {
  if (message.role === "user")
    return <UserMessage message={message} busy={busy} onResubmit={onResubmit} />;
  if (!hasAssistantContent(message)) return null;
  return <AssistantMessage message={message} onToolDecision={onToolDecision} onCancel={onCancel} />;
}
