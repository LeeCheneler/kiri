import { Route, Switch } from "wouter";
import { PageShell } from "./components/page-shell.tsx";
import { type EventSourceFactory, LiveEventsProvider } from "./events/live.tsx";
import { Dashboard } from "./routes/dashboard.tsx";
import { RunPage } from "./routes/run-page.tsx";
import { WorkflowPage } from "./routes/workflow-page.tsx";

/**
 * Root client shell. Mounts the live events provider once so every route
 * shares the single `EventSource('/api/events')` connection, then wraps
 * the wouter route switch in the page shell so each route inherits the
 * three-column layout and the kiri wordmark.
 *
 * `liveEventsFactory` is a test seam — production callers omit it and
 * get the native `EventSource`.
 */
export function App({ liveEventsFactory }: { liveEventsFactory?: EventSourceFactory } = {}) {
  return (
    <LiveEventsProvider factory={liveEventsFactory}>
      <PageShell>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/workflows/:name" component={WorkflowPage} />
          <Route path="/runs/:id" component={RunPage} />
          <Route>
            <p>Page not found.</p>
          </Route>
        </Switch>
      </PageShell>
    </LiveEventsProvider>
  );
}
