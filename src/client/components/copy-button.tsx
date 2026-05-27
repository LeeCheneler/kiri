import { useEffect, useState } from "react";

/**
 * Copies `content` to the system clipboard on click, rendered as an
 * inline accent-coloured text link to sit alongside other byline
 * actions. Briefly swaps the label to "copied" for `feedbackMs` so the
 * user gets visual confirmation — the clipboard write is otherwise
 * invisible. Surfaces an inline error if the clipboard API rejects
 * (insecure context, permissions denied, etc.).
 *
 * `feedbackMs` is exposed so tests can shorten the confirmation window
 * without waiting for the real one.
 */
export function CopyButton({
  content,
  feedbackMs = 1500,
}: {
  content: string;
  feedbackMs?: number;
}) {
  const [status, setStatus] = useState<"idle" | "copied">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "copied") return;
    const timer = setTimeout(() => setStatus("idle"), feedbackMs);
    return () => clearTimeout(timer);
  }, [status, feedbackMs]);

  const handleClick = async () => {
    setError(null);
    try {
      await navigator.clipboard.writeText(content);
      setStatus("copied");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <span className="inline-flex items-baseline gap-2">
      <button
        type="button"
        onClick={handleClick}
        className="cursor-pointer bg-transparent p-0 font-mono text-xs text-accent no-underline outline-none transition-colors duration-150 hover:text-ink focus-visible:text-ink focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1"
      >
        {status === "copied" ? "copied" : "copy markdown"}
      </button>
      {error && (
        <span role="alert" className="text-status-failed">
          {error}
        </span>
      )}
    </span>
  );
}
