import type { ReactNode } from "react";

/**
 * Inline metadata row — a sequence of small machine-layer facts (a status,
 * a time, a duration, a short SHA) rendered in mono and separated by a
 * muted middot. List the facts as children; the separator is inserted
 * between each, so callers never write the dots themselves. The byline
 * above a run or article is the canonical use.
 */
export function Meta({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center font-mono text-xs text-ink-muted [&>*+*]:before:mx-2 [&>*+*]:before:text-ink-faint [&>*+*]:before:content-['·']">
      {children}
    </div>
  );
}
