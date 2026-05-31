import { Breadcrumb } from "../design-system/navigation/breadcrumb.tsx";
import { ActivityFeed } from "../features/activity-feed/activity-feed.tsx";
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
 * Home content — the Activity breadcrumb above the live, cross-workflow
 * activity feed. `now` is injectable so tests render deterministic timestamps.
 */
export function HomeContent({ now }: { now?: Date }) {
  return (
    <section>
      <Breadcrumb items={[]} current="Activity" />
      <div className="mt-6">
        <ActivityFeed now={now} />
      </div>
    </section>
  );
}
