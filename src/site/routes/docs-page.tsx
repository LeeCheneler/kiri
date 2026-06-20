import { Eyebrow } from "../../client/design-system/content/eyebrow.tsx";
import { InlineLink } from "../../client/design-system/content/inline-link.tsx";
import { Notice } from "../../client/design-system/feedback/notice.tsx";
import { SiteFooter } from "../chrome/site-footer.tsx";
import { SiteHeader } from "../chrome/site-header.tsx";

/**
 * Documentation shell. The page frame the multi-page docs will fill — for now
 * an honest empty state pointing at the README. Reuses the site chrome and the
 * design system so it matches the rest of the site.
 */
export function DocsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-20 sm:px-8 lg:py-28">
        <Eyebrow>Documentation</Eyebrow>
        <h1 className="mt-4 font-display text-4xl text-ink italic leading-tight">
          The docs are being written.
        </h1>
        <p className="mt-6 font-mono text-sm text-ink-muted leading-relaxed">
          Full guides — getting started, workflows, agentic sessions, the CLI, and more — are on the
          way. Until they land, the{" "}
          <InlineLink href="https://github.com/LeeCheneler/kiri">README on GitHub</InlineLink> is
          the best reference.
        </p>
        <div className="mt-10">
          <Notice tone="informational" title="Coming soon">
            Bookmark this page — it's where the documentation will live.
          </Notice>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
