import { InlineLink } from "../../client/design-system/content/inline-link.tsx";
import { SiteFooter } from "../chrome/site-footer.tsx";
import { SiteHeader } from "../chrome/site-header.tsx";

/**
 * Catch-all for unknown routes. Wraps the same site chrome so a stray URL
 * still lands somewhere coherent.
 */
export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-20 sm:px-8 lg:py-28">
        <h1 className="font-display text-4xl text-ink italic leading-tight">Not found</h1>
        <p className="mt-6 font-mono text-sm text-ink-muted leading-relaxed">
          That page doesn't exist. <InlineLink href="/">Head home</InlineLink>.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
