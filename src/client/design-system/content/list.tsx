import type { ReactNode } from "react";

// Item text colour is left to inherit (the app root defaults to ink) so a
// list inside a muted block tints with it; only the markers pin to muted.
const SHARED = "ml-6 space-y-1.5 marker:text-ink-muted [&>li]:leading-relaxed";

/**
 * Reading-content list. Bulleted by default; pass `ordered` for a numbered
 * list. Markers sit in muted ink so they frame the items without competing
 * with them. Children are the `<li>` elements, and the list inherits the
 * reading voice from its surrounding Prose. Spacing above and below the
 * list is the caller's layout concern.
 */
export function List({ ordered = false, children }: { ordered?: boolean; children: ReactNode }) {
  if (ordered) {
    return <ol className={`list-decimal ${SHARED}`}>{children}</ol>;
  }
  return <ul className={`list-disc ${SHARED}`}>{children}</ul>;
}
