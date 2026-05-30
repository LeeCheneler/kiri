import type { ReactNode } from "react";

/**
 * A "working on it" message in the reading voice — italic Fraunces, muted, with
 * a slow shimmer sweeping across it — for a body that is mid-fetch. The loading
 * twin of `EmptyState`, but rendered as `<output>` (implicit `role="status"`)
 * so assistive tech announces the transition, and animated to signal liveness.
 * The shimmer pauses for `prefers-reduced-motion`. Carries no outer margin.
 */
export function LoadingState({ children }: { children: ReactNode }) {
  return (
    <output className="block animate-text-shimmer bg-[linear-gradient(110deg,var(--color-ink-muted)_42%,var(--color-ink)_50%,var(--color-ink-muted)_58%)] bg-[length:200%_100%] bg-clip-text font-display text-base text-transparent italic">
      {children}
    </output>
  );
}
