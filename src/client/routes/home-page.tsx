import { Breadcrumb } from "../design-system/navigation/breadcrumb.tsx";
import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";

/**
 * Home route. Composes the Activity view into the page shell.
 */
export function HomePage() {
  return (
    <PageShell left={<SiteNav />}>
      <HomeContent />
    </PageShell>
  );
}

/**
 * Home content — the Activity view's breadcrumb anchor.
 */
export function HomeContent() {
  return (
    <section>
      <Breadcrumb items={[]} current="Activity" />
    </section>
  );
}
