import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";

/**
 * Fallback route for an unmatched path. Renders inside the page shell so
 * the nav stays available to recover from a bad link.
 */
export function NotFoundPage() {
  return (
    <PageShell left={<SiteNav />}>
      <p className="font-mono text-sm text-ink-muted">Page not found.</p>
    </PageShell>
  );
}
