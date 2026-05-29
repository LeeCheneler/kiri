import type { ReactNode } from "react";
import { Route, Switch, useLocation } from "wouter";
import { ArticleAside } from "./components/article-aside.tsx";
import { PageShell } from "./components/page-shell.tsx";
import { RecentlyPublished } from "./components/recently-published.tsx";
import { ToastContainer } from "./components/toast-container.tsx";
import { type EventSourceFactory, LiveEventsProvider } from "./events/live.tsx";
import { ArticlePage } from "./routes/article-page.tsx";
import { Dashboard } from "./routes/dashboard.tsx";
import { DesignSystem, DesignSystemAside } from "./routes/design-system.tsx";
import { RunPage } from "./routes/run-page.tsx";
import { WorkflowPage } from "./routes/workflow-page.tsx";

const ARTICLE_ROUTE = /^\/runs\/[^/]+\/published\/[^/]+$/;

// Right-rail marginalia keyed by exact path. The article route is dynamic
// (run id + article name), so it's matched by pattern rather than keyed here.
const RIGHT_ASIDE_BY_PATH: Record<string, ReactNode> = {
  "/": <RecentlyPublished />,
  "/dev/design-system": <DesignSystemAside />,
};

/**
 * Root client shell. Mounts the live events provider once so every route
 * shares the single `EventSource('/api/events')` connection, then wraps
 * the wouter route switch in the page shell so each route inherits the
 * three-column layout and the kiri wordmark. The toast container sits
 * alongside the shell so completion notifications float over whatever
 * route is mounted.
 *
 * The right rail is route-dependent: the article reading view gets its
 * marginalia TOC, the home dashboard keeps the cross-run
 * recently-published shortlist, the design-system page gets a TOC of its
 * own sections, and other routes leave it empty.
 *
 * `liveEventsFactory` is a test seam — production callers omit it and
 * get the native `EventSource`.
 */
export function App({ liveEventsFactory }: { liveEventsFactory?: EventSourceFactory } = {}) {
  const [location] = useLocation();
  const rightAside = ARTICLE_ROUTE.test(location) ? (
    <ArticleAside />
  ) : (
    RIGHT_ASIDE_BY_PATH[location]
  );
  return (
    <LiveEventsProvider factory={liveEventsFactory}>
      <PageShell rightAside={rightAside}>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/workflows/:name" component={WorkflowPage} />
          <Route path="/runs/:id/published/:name" component={ArticlePage} />
          <Route path="/runs/:id" component={RunPage} />
          <Route path="/dev/design-system" component={DesignSystem} />
          <Route>
            <p>Page not found.</p>
          </Route>
        </Switch>
      </PageShell>
      <ToastContainer />
    </LiveEventsProvider>
  );
}
