import { useEffect, useState } from "react";
import { Toc, type TocEntry } from "../../design-system/navigation/toc.tsx";

const SECTION_ID_PREFIX = "section-";
const EYEBROW_PREFIX = /^§\s*\d+\s*/;

const collectEntries = (): TocEntry[] => {
  const headings = document.querySelectorAll<HTMLElement>(`[id^="${SECTION_ID_PREFIX}"]`);
  return Array.from(headings).map((heading) => {
    const id = heading.id;
    const ordinal = id.slice(SECTION_ID_PREFIX.length);
    // The heading's text content includes the aria-hidden `§ NN` eyebrow span
    // as its first child — strip it so the label is just the section's prose
    // title.
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
 * The article reading view's right-rail table of contents. Collects the
 * `section-NN` anchors that `<Markdown withSectionOrdinals>` stamps onto the
 * rendered body, strips their `§ NN` eyebrow to recover each section's title,
 * and feeds the design-system `Toc`, which owns presentation and scroll-spy.
 *
 * Collection reads off the live document, and a `<main>`-scoped
 * MutationObserver re-syncs when the body arrives after mount (an article
 * fetch resolving) or the reader moves to a different article. Identical
 * heading sets are ignored so an unrelated body mutation (a lazy chart
 * mounting) doesn't churn the rail. `Toc` renders nothing when there are no
 * sections, so the rail stays empty rather than showing a bare heading.
 */
export function ArticleToc() {
  const [entries, setEntries] = useState<TocEntry[]>([]);

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

  return <Toc entries={entries} heading="In this article" />;
}
