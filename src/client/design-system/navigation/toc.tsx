import { type ReactNode, useEffect, useId, useState } from "react";

/** One entry in a table of contents: an anchor target, a label, and an optional ordinal. */
export type TocEntry = {
  id: string;
  label: string;
  ordinal?: string;
};

/**
 * Table of contents with scroll-spy. Renders `entries` as in-page links inside
 * a labelled `<nav>`, and highlights the entry whose target sits in the
 * reader's active zone — the top ~30% of the viewport — as the "you are here"
 * marker, defaulting to the first entry before any scroll. Each entry links to
 * `#id`; on load, a fragment naming an entry is scrolled into view, which a
 * client-rendered page can't do itself. Pass an `ordinal` for the faint leading
 * number. Collecting the headings is the caller's job — this owns presentation
 * and active-tracking only — and it carries no margin of its own.
 */
export function Toc({
  entries,
  heading = "Contents",
}: {
  entries: TocEntry[];
  heading?: string;
}): ReactNode {
  const headingId = useId();
  const [activeId, setActiveId] = useState<string | null>(null);

  // On load, honour a URL fragment naming one of these entries: a client-
  // rendered page isn't in the DOM when the browser first tries to scroll to
  // the fragment, so do it once the targets are mounted.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id !== "" && entries.some((entry) => entry.id === id)) {
      document.getElementById(id)?.scrollIntoView();
    }
  }, [entries]);

  useEffect(() => {
    if (entries.length === 0) {
      setActiveId(null);
      return;
    }
    // Keep the first entry marked until a scroll moves the cursor.
    setActiveId((current) => current ?? entries[0].id);
    if (typeof IntersectionObserver === "undefined") return;

    const inView = new Set<string>();
    const observer = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          const id = (record.target as HTMLElement).id;
          if (record.isIntersecting) inView.add(id);
          else inView.delete(id);
        }
        // The topmost in-view target wins, so the marker tracks reading order.
        const next = entries.find((entry) => inView.has(entry.id))?.id;
        if (next !== undefined) setActiveId(next);
      },
      { rootMargin: "0px 0px -70% 0px", threshold: 0 },
    );

    for (const entry of entries) {
      const el = document.getElementById(entry.id);
      if (el !== null) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <nav aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="mb-3.5 border-rule border-b pb-2 font-mono text-xs tracking-widest text-ink-muted uppercase"
      >
        {heading}
      </h2>
      <ul>
        {entries.map((entry) => {
          const isActive = entry.id === activeId;
          const borderClass = isActive ? "border-accent" : "border-transparent";
          const textClass = isActive ? "text-accent" : "text-ink-muted";
          return (
            <li key={entry.id}>
              <a
                href={`#${entry.id}`}
                aria-current={isActive ? "true" : undefined}
                className={`grid grid-cols-[auto_1fr] items-baseline gap-2.5 border-l py-1.5 pl-2.5 font-mono text-xs no-underline transition-colors hover:text-accent ${borderClass} ${textClass}`}
              >
                {entry.ordinal !== undefined && (
                  <span className="text-ink-faint">{entry.ordinal}</span>
                )}
                <span>{entry.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
