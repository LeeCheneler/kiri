import { useEffect } from "react";
import { Markdown } from "../../client/design-system/content/markdown.tsx";
import { DocsLayout } from "../chrome/docs-layout.tsx";
import { DOCS_INDEX_SLUG, getDocsPage } from "../docs/docs-nav.ts";

/**
 * Documentation page. Resolves the page for the current slug — defaulting to
 * the landing page served at `/docs` — and renders its markdown through the
 * shared design-system `Markdown`, so prose, code, charts, and diagrams read
 * exactly as they do in the app. Every heading carries an id slugged from
 * its text, so authored anchor links resolve; the sectioned headings also
 * carry the ordinals the right-rail table of contents tracks.
 */
export function DocsPage({ params }: { params?: { slug?: string } }) {
  const slug = params?.slug ?? DOCS_INDEX_SLUG;

  // wouter keeps the prior scroll position across client-side navigation,
  // which would otherwise land the reader part-way down the next page. A
  // cross-page anchor link carries its fragment through the navigation, so
  // honour it when its heading exists; otherwise reset to the top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: slug is the change trigger to re-run on, not a value the body reads.
  useEffect(() => {
    const target =
      window.location.hash === "" ? null : document.getElementById(window.location.hash.slice(1));
    if (target !== null) {
      target.scrollIntoView();
      return;
    }
    window.scrollTo(0, 0);
  }, [slug]);

  const page = getDocsPage(slug);

  if (page === undefined) {
    return (
      <DocsLayout>
        <h1 className="font-display text-3xl text-ink leading-tight">Page not found</h1>
        <p className="mt-4 font-mono text-sm text-ink-muted leading-relaxed">
          That documentation page doesn't exist. Pick one from the list on the left.
        </p>
      </DocsLayout>
    );
  }

  return (
    <DocsLayout>
      <Markdown content={page.content} withSectionOrdinals sectionLevel={2} />
    </DocsLayout>
  );
}
