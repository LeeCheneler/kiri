import type { ReactNode } from "react";

/**
 * Inline code token — a mono chip for a snippet, filename, or literal
 * value sitting inside a run of prose. The chip background lifts it off
 * the body text so it reads as the machine layer rather than prose.
 */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-sm bg-paper-2 px-2 py-0.5 font-mono text-sm text-ink">{children}</code>
  );
}

/**
 * Fenced code block — a bordered mono panel for a multi-line snippet.
 * Preserves whitespace and never reflows; long lines scroll horizontally
 * rather than wrapping. Owns its frame and padding only; the space around
 * it is the caller's layout concern.
 */
export function CodeBlock({ children }: { children: ReactNode }) {
  return (
    <pre className="overflow-x-auto border border-rule bg-paper p-4 font-mono text-sm text-ink">
      <code>{children}</code>
    </pre>
  );
}
