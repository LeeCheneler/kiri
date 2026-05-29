import type { ReactNode } from "react";

/**
 * Block quotation — an offset passage in muted italic with a rule down the
 * left edge, marking words lifted from elsewhere (a source, a cited line)
 * within reading content. Inherits the reading voice from the surrounding
 * Prose; the space around it is the caller's layout concern.
 */
export function Quote({ children }: { children: ReactNode }) {
  return (
    <blockquote className="border-l-2 border-rule pl-4 text-ink-muted italic">
      {children}
    </blockquote>
  );
}
