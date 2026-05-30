import { Breadcrumb } from "../design-system/navigation/breadcrumb.tsx";
import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";

/**
 * Fallback route for an unmatched path. Renders inside the page shell so
 * the nav stays available to recover from a bad link.
 */
export function NotFoundPage() {
  return (
    <PageShell left={<SiteNav />}>
      <section>
        <Breadcrumb items={[{ label: "Activity", href: "/" }]} current="Not found" />
        <h2 className="mt-6 font-display text-4xl text-ink leading-tight">Page not found</h2>
        <p className="mt-3 font-mono text-sm text-ink-muted">
          The page you’re looking for doesn’t exist.
        </p>
      </section>
    </PageShell>
  );
}
