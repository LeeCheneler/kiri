import { useEffect, useState } from "react";
import { Toc, type TocEntry } from "../../client/design-system/navigation/toc.tsx";

const EYEBROW_PREFIX = /^§\s*\d+\s*/;

const collectEntries = (): TocEntry[] => {
  const headings = document.querySelectorAll<HTMLElement>("[data-section]");
  return Array.from(headings).map((heading) => {
    const ordinal = heading.getAttribute("data-section") ?? "";
    // The heading text leads with the aria-hidden `§ NN` eyebrow span — strip
    // it so the label is just the section's prose title.
    const label = (heading.textContent ?? "").replace(EYEBROW_PREFIX, "").trim();
    return { id: heading.id, ordinal, label };
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
 * Docs right-rail table of contents. Collects the `data-section` headings that
 * `<Markdown withSectionOrdinals>` stamps onto the rendered page, recovers each
 * section's title, and feeds the design-system `Toc`, which owns presentation
 * and scroll-spy. A `<main>`-scoped MutationObserver re-syncs when the reader
 * moves to a different page or a lazy chart/diagram mounts; identical heading
 * sets are ignored so the rail doesn't churn. `Toc` renders nothing when there
 * are no sections, so the rail stays empty rather than showing a bare heading.
 */
export function DocsToc() {
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

  return <Toc entries={entries} heading="On this page" />;
}
