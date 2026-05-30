import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Route, Switch } from "wouter";
import { ToastContainer } from "./components/toast-container.tsx";
import { type EventSourceFactory, LiveEventsProvider } from "./events/live.tsx";
import { ArticlePage } from "./routes/article-page.tsx";
import { DesignSystemPage } from "./routes/design-system-page.tsx";
import { HomePage } from "./routes/home-page.tsx";
import { NotFoundPage } from "./routes/not-found-page.tsx";
import { RunPage } from "./routes/run-page.tsx";
import { WorkflowPage } from "./routes/workflow-page.tsx";
import { LiveSync } from "./state/live-sync.tsx";
import { createQueryClient } from "./state/query-client.ts";

/**
 * Root client shell. Owns the query client and the live events provider
 * so every route shares one cache and the single
 * `EventSource('/api/events')` connection; `<LiveSync>` bridges the two,
 * invalidating cached queries as server events arrive. Each route renders
 * its own page shell (wordmark, nav, and right-rail marginalia), so the
 * root is just providers, the route switch, and the toast container —
 * which sits alongside the switch so completion notifications float over
 * whatever route is mounted.
 *
 * `liveEventsFactory` is a test seam — production callers omit it and
 * get the native `EventSource`.
 */
export function App({ liveEventsFactory }: { liveEventsFactory?: EventSourceFactory } = {}) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <LiveEventsProvider factory={liveEventsFactory}>
        <LiveSync />
        <Switch>
          <Route path="/" component={HomePage} />
          <Route path="/workflows/:name" component={WorkflowPage} />
          <Route path="/runs/:id/published/:name" component={ArticlePage} />
          <Route path="/runs/:id" component={RunPage} />
          <Route path="/dev/design-system" component={DesignSystemPage} />
          <Route component={NotFoundPage} />
        </Switch>
        <ToastContainer />
      </LiveEventsProvider>
    </QueryClientProvider>
  );
}
