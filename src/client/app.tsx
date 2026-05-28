import { Route, Switch, useLocation } from "wouter";
import { ArticleAside } from "./components/article-aside.tsx";
import { PageShell } from "./components/page-shell.tsx";
import { RecentlyPublished } from "./components/recently-published.tsx";
import { ToastContainer } from "./components/toast-container.tsx";
import { type EventSourceFactory, LiveEventsProvider } from "./events/live.tsx";
import { ArticlePage } from "./routes/article-page.tsx";
import { Dashboard } from "./routes/dashboard.tsx";
import { RunPage } from "./routes/run-page.tsx";
import { WorkflowPage } from "./routes/workflow-page.tsx";

const ARTICLE_ROUTE = /^\/runs\/[^/]+\/published\/[^/]+$/;

/**
 * Root client shell. Mounts the live events provider once so every route
 * shares the single `EventSource('/api/events')` connection, then wraps
 * the wouter route switch in the page shell so each route inherits the
 * three-column layout and the kiri wordmark. The toast container sits
 * alongside the shell so completion notifications float over whatever
 * route is mounted.
 *
 * The right rail is route-dependent: the article reading view gets its
 * marginalia TOC, every other route keeps the cross-run
 * recently-published shortlist.
 *
 * `liveEventsFactory` is a test seam — production callers omit it and
 * get the native `EventSource`.
 */
export function App({ liveEventsFactory }: { liveEventsFactory?: EventSourceFactory } = {}) {
  const [location] = useLocation();
  const rightAside = ARTICLE_ROUTE.test(location) ? <ArticleAside /> : <RecentlyPublished />;
  return (
    <LiveEventsProvider factory={liveEventsFactory}>
      <PageShell rightAside={rightAside}>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/workflows/:name" component={WorkflowPage} />
          <Route path="/runs/:id/published/:name" component={ArticlePage} />
          <Route path="/runs/:id" component={RunPage} />
          <Route>
            <p>Page not found.</p>
          </Route>
        </Switch>
      </PageShell>
      <ToastContainer />
    </LiveEventsProvider>
  );
}
