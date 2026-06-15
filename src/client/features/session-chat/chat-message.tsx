import type { UIMessage } from "ai";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { Markdown } from "../../design-system/content/markdown.tsx";

// Join the message's text parts. M1 messages are text-only; tool-call and file
// parts (later milestones) are simply skipped here until they have a renderer.
const messageText = (message: UIMessage): string =>
  message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");

/**
 * One chat message. A user message renders its text verbatim (whitespace
 * preserved); an assistant message renders as markdown through the design
 * system. Labelled with who spoke so the transcript reads as a conversation.
 * A just-submitted assistant turn, still awaiting its first token, renders
 * nothing.
 */
export function ChatMessage({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const text = messageText(message);
  // An assistant message joins the transcript the moment a turn is submitted,
  // before any token arrives. Hold it back until it has content, so the
  // "Assistant" label lands with the first streamed text rather than hanging
  // empty above the working indicator.
  if (!isUser && text === "") return null;
  return (
    <article>
      <Eyebrow tone={isUser ? "muted" : "accent"}>{isUser ? "You" : "Assistant"}</Eyebrow>
      <div className="mt-2">
        {isUser ? (
          <p className="whitespace-pre-wrap font-mono text-sm text-ink">{text}</p>
        ) : (
          <Markdown content={text} />
        )}
      </div>
    </article>
  );
}
