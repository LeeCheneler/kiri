import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Route, Switch } from "wouter";
import { type EventSourceFactory, LiveEventsProvider } from "./events/live.tsx";
import { ScrollReset } from "./features/page-shell/scroll-reset.tsx";
import { SearchProvider } from "./features/search/search-provider.tsx";
import { ArticlePage } from "./routes/article-page.tsx";
import { DesignSystemPage } from "./routes/design-system-page.tsx";
import { GitPage } from "./routes/git-page.tsx";
import { GitRepoPage } from "./routes/git-repo-page.tsx";
import { HomePage } from "./routes/home-page.tsx";
import { McpPage } from "./routes/mcp-page.tsx";
import { NotFoundPage } from "./routes/not-found-page.tsx";
import { RunPage } from "./routes/run-page.tsx";
import { SessionArticlePage } from "./routes/session-article-page.tsx";
import { SessionPage } from "./routes/session-page.tsx";
import { WorkflowPage } from "./routes/workflow-page.tsx";
import { WorkflowsPage } from "./routes/workflows-page.tsx";
import { LiveSync } from "./state/live-sync.tsx";
import { createQueryClient } from "./state/query-client.ts";

/**
 * Root client shell. Owns the query client and the live events provider
 * so every route shares one cache and the single
 * `EventSource('/api/events')` connection; `<LiveSync>` bridges the two,
 * invalidating cached queries as server events arrive. Each route renders
 * its own page shell (wordmark, nav, and right-rail marginalia), so the
 * root is just the providers and the route switch. `<SearchProvider>`
 * hosts the search overlay above the routes so ⌘K reaches it from any page.
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
        <ScrollReset />
        <SearchProvider>
          <Switch>
            <Route path="/" component={HomePage} />
            <Route path="/workflows" component={WorkflowsPage} />
            <Route path="/workflows/:name" component={WorkflowPage} />
            <Route path="/git" component={GitPage} />
            <Route path="/git/:repo" component={GitRepoPage} />
            <Route path="/mcp" component={McpPage} />
            <Route path="/sessions/:id/articles/:slug" component={SessionArticlePage} />
            <Route path="/sessions/:id" component={SessionPage} />
            <Route path="/runs/:id/articles/:slug" component={ArticlePage} />
            <Route path="/runs/:id" component={RunPage} />
            <Route path="/dev/design-system" component={DesignSystemPage} />
            <Route component={NotFoundPage} />
          </Switch>
        </SearchProvider>
      </LiveEventsProvider>
    </QueryClientProvider>
  );
}
