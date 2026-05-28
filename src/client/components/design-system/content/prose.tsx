import type { ReactNode } from "react";

/**
 * Reading-measure container for body content. Owns the prose measure so a
 * run of text never grows past a comfortable line length, and sets the
 * base reading voice (Fraunces, relaxed leading). Wrap any body copy — a
 * guideline, an article, a rendered summary — in this and let it own the
 * width; never put a max-width on text by hand.
 */
export function Prose({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-[65ch] font-display text-base text-ink leading-relaxed">{children}</div>
  );
}
