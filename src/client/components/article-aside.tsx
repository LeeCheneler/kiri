import { type ReactNode, useEffect, useState } from "react";

type TocEntry = {
  id: string;
  ordinal: string;
  label: string;
};

const SECTION_ID_PREFIX = "section-";
const EYEBROW_PREFIX = /^§\s*\d+\s*/;

const collectEntries = (): TocEntry[] => {
  const headings = document.querySelectorAll<HTMLElement>(`[id^="${SECTION_ID_PREFIX}"]`);
  return Array.from(headings).map((heading) => {
    const id = heading.id;
    const ordinal = id.slice(SECTION_ID_PREFIX.length);
    // The heading's text content includes the aria-hidden `§ NN` eyebrow
    // span as its first child — strip it so the TOC label is just the
    // section's prose title.
    const label = (heading.textContent ?? "").replace(EYEBROW_PREFIX, "").trim();
    return { id, ordinal, label };
  });
};

const sameEntries = (a: TocEntry[], b: TocEntry[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].label !== b[i].label) return false;
  }
  return true;
};

/**
 * Right-rail marginalia for the article reading view: an "In this
 * article" TOC built from the rendered body headings (the `section-NN`
 * anchors stamped by `<Markdown withSectionOrdinals>`). Each entry is a
 * link to its target, and the entry currently in the reader's active
 * zone (the top 30% of the viewport) is highlighted with an accent
 * left-border.
 *
 * The component is route-agnostic by design — it reads headings off the
 * live document. A MutationObserver scoped to `<main>` re-syncs the TOC
 * when content arrives after mount (e.g. an article fetch resolving)
 * or when the user navigates to a different article.
 *
 * Returns `null` when the page has no section anchors so the right rail
 * shows nothing rather than an empty TOC heading.
 */
export function ArticleAside(): ReactNode {
  const [entries, setEntries] = useState<TocEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => {
      const next = collectEntries();
      setEntries((prev) => (sameEntries(prev, next) ? prev : next));
    };

    refresh();

    const main = document.querySelector("main");
    if (main === null) return;
    const observer = new MutationObserver(refresh);
    observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (entries.length === 0) {
      setActiveId(null);
      return;
    }
    // Default the active marker to the first section so the rail has
    // something highlighted before the user starts scrolling.
    setActiveId((current) => current ?? entries[0].id);
    if (typeof IntersectionObserver === "undefined") return;

    // Confine the "active zone" to roughly the top 30% of the viewport —
    // the section that's just entered the reader's eyeline becomes the
    // active TOC entry, mirroring how an editorial print cursor moves.
    const inView = new Set<string>();
    const observer = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          const id = (record.target as HTMLElement).id;
          if (record.isIntersecting) inView.add(id);
          else inView.delete(id);
        }
        // Pick the topmost (first in entries order) intersecting id so
        // the highlight tracks the reader's progress through the article.
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
    <section aria-labelledby="article-toc-heading">
      <h2
        id="article-toc-heading"
        className="mb-3.5 border-rule border-b pb-2 font-mono text-xs tracking-widest text-ink-muted uppercase"
      >
        In this article
      </h2>
      <nav aria-label="article sections">
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
                  <span className="text-ink-faint">{entry.ordinal}</span>
                  <span>{entry.label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </section>
  );
}
