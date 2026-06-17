import type { FileUIPart, UIMessage } from "ai";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { Markdown } from "../../design-system/content/markdown.tsx";
import { PreviewableImage } from "./image-thumb.tsx";

// Join the message's text parts. Non-text parts (tool calls, files) are skipped
// here — image file parts are rendered separately as thumbnails (below).
const messageText = (message: UIMessage): string =>
  message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");

// The image attachments on a message, rendered as thumbnails above its text.
const imageParts = (message: UIMessage): FileUIPart[] =>
  message.parts.filter(
    (part): part is FileUIPart => part.type === "file" && part.mediaType.startsWith("image/"),
  );

/**
 * One chat message. A user message renders its text verbatim (whitespace
 * preserved); an assistant message renders as markdown through the design
 * system. Any image attachments render as thumbnails above the text, each
 * opening a full-size preview on click. Labelled with who spoke so the
 * transcript reads as a conversation. A just-submitted assistant turn, still
 * awaiting its first token, renders nothing.
 */
export function ChatMessage({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const text = messageText(message);
  const images = imageParts(message);
  // An assistant message joins the transcript the moment a turn is submitted,
  // before any token arrives. Hold it back until it has content, so the
  // "Assistant" label lands with the first streamed text rather than hanging
  // empty above the working indicator. (Assistant turns carry no images.)
  if (!isUser && text === "" && images.length === 0) return null;
  return (
    <article>
      <Eyebrow tone={isUser ? "muted" : "accent"}>{isUser ? "You" : "Assistant"}</Eyebrow>
      <div className="mt-2 space-y-3">
        {images.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {images.map((part) => (
              <PreviewableImage key={part.url} part={part} />
            ))}
          </div>
        ) : null}
        {text !== "" ? (
          isUser ? (
            <p className="whitespace-pre-wrap font-mono text-sm text-ink">{text}</p>
          ) : (
            <Markdown content={text} />
          )
        ) : null}
      </div>
    </article>
  );
}
