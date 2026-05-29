import type { ReactNode } from "react";

/**
 * A "nothing here yet" message in the reading voice — italic Fraunces, muted.
 * Takes `children` so a caller can weave inline elements into the sentence (a
 * Code chip naming a command, a link). Render it directly, or hand it to a
 * component's empty slot such as NavList's `emptyState`. Carries no outer
 * margin.
 */
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="font-display text-base text-ink-muted italic">{children}</p>;
}
