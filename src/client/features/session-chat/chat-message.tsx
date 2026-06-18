import { type FileUIPart, type UIMessage, isToolUIPart } from "ai";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { Markdown } from "../../design-system/content/markdown.tsx";
import { PreviewableImage } from "./image-thumb.tsx";
import { ToolInvocation } from "./tool-invocation.tsx";

// Join the message's text parts. Non-text parts (tool calls, files) are skipped
// here — image file parts are rendered separately as thumbnails (below).
const messageText = (message: UIMessage): string =>
  message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");

// The image attachments on a message, rendered as thumbnails above its text.
const imageParts = (message: UIMessage): FileUIPart[] =>
  message.parts.filter(
    (part): part is FileUIPart => part.type === "file" && part.mediaType.startsWith("image/"),
  );

// Whether an assistant message has anything worth rendering yet: non-empty text
// or a tool call. A just-submitted turn has neither until its first chunk lands.
const hasAssistantContent = (message: UIMessage): boolean =>
  message.parts.some((part) => (part.type === "text" && part.text !== "") || isToolUIPart(part));

// A user message: image thumbnails above its text, the text rendered verbatim
// (whitespace preserved) since it's exactly what the user typed.
function UserMessage({ message }: { message: UIMessage }) {
  const text = messageText(message);
  const images = imageParts(message);
  return (
    <article>
      <Eyebrow tone="muted">You</Eyebrow>
      <div className="mt-2 space-y-3">
        {images.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {images.map((part) => (
              <PreviewableImage key={part.url} part={part} />
            ))}
          </div>
        ) : null}
        {text !== "" ? (
          <p className="whitespace-pre-wrap font-mono text-sm text-ink">{text}</p>
        ) : null}
      </div>
    </article>
  );
}

// An assistant message: its parts rendered in order so tool calls sit inline
// with the prose — a lead-in line, the tool block, then the answer that follows.
// Text renders as markdown; tool calls render as collapsible tool blocks.
function AssistantMessage({ message }: { message: UIMessage }) {
  return (
    <article>
      <Eyebrow tone="accent">Assistant</Eyebrow>
      <div className="mt-2 space-y-3">
        {message.parts.map((part, index) => {
          if (part.type === "text" && part.text !== "") {
            // biome-ignore lint/suspicious/noArrayIndexKey: assistant parts are append-only within a turn and never reorder, so the index is a stable key.
            return <Markdown key={index} content={part.text} />;
          }
          if (isToolUIPart(part)) return <ToolInvocation key={part.toolCallId} part={part} />;
          return null;
        })}
      </div>
    </article>
  );
}

/**
 * One chat message. A user message renders its text verbatim with any image
 * attachments as thumbnails; an assistant message renders its parts in order —
 * markdown prose interleaved with collapsible tool-call blocks. Labelled with
 * who spoke so the transcript reads as a conversation. A just-submitted
 * assistant turn, still awaiting its first chunk, renders nothing.
 */
export function ChatMessage({ message }: { message: UIMessage }) {
  if (message.role === "user") return <UserMessage message={message} />;
  if (!hasAssistantContent(message)) return null;
  return <AssistantMessage message={message} />;
}
