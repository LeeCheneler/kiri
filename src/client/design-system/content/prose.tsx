import type { ReactNode } from "react";

/**
 * Reading-measure container for body content. Owns the prose measure so a
 * run of text never grows past a comfortable line length, and sets the
 * base reading voice (Fraunces, relaxed leading). Wrap any body copy — a
 * guideline, an article, a rendered summary — in this and let it own the
 * width; never put a max-width on text by hand.
 */
export function Prose({ children }: { children: ReactNode }) {
  // Text colour is deliberately not set: the app root already defaults to
  // ink, so leaving it unstated lets a wrapping tint (e.g. `text-ink-muted`
  // on a secondary summary) inherit through to the content.
  return <div className="max-w-[75ch] font-display text-base leading-relaxed">{children}</div>;
}
