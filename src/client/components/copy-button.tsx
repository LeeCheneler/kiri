import { useEffect, useState } from "react";

/**
 * Copies `content` to the system clipboard on click. Briefly swaps the
 * label to "copied" for `feedbackMs` so the user gets visual confirmation —
 * the clipboard write is otherwise invisible. Surfaces an inline error if
 * the clipboard API rejects (insecure context, permissions denied, etc.).
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
    <div className="shrink-0 text-right">
      <button
        type="button"
        onClick={handleClick}
        className="cursor-pointer border border-rule px-3 py-1.5 font-mono text-xs tracking-widest text-ink uppercase no-underline outline-none transition-colors duration-150 hover:border-accent hover:text-accent focus-visible:border-accent focus-visible:text-accent focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1"
      >
        {status === "copied" ? "copied" : "copy"}
      </button>
      {error && (
        <p role="alert" className="mt-2 max-w-xs font-mono text-xs text-status-failed normal-case">
          {error}
        </p>
      )}
    </div>
  );
}
