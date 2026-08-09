import type { ReactNode } from "react";

/**
 * A content block edged on the left in accent — the counterpart to
 * `StatusBlock` for an entry with no lifecycle to report. An article in the
 * activity feed is the case it exists for: it sits among status-edged run and
 * session rows, and giving it the accent edge says it is something the system
 * produced rather than something the system did. Wraps `children` behind the
 * border and exposes `data-edge` for containers and tests to anchor on.
 *
 * Reach for `StatusBlock` whenever the entry *has* a status — its edge colour
 * carries that state, which this block deliberately doesn't. Like it, this one
 * owns its border and inset only; vertical rhythm between stacked blocks is
 * the caller's.
 */
export function EdgedBlock({ children }: { children: ReactNode }) {
  return (
    <div data-edge="accent" className="border-l-2 border-accent-deep pl-4">
      {children}
    </div>
  );
}
