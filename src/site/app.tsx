import { Route, Switch } from "wouter";
import { DocsPage } from "./routes/docs-page.tsx";
import { HomePage } from "./routes/home-page.tsx";
import { NotFoundPage } from "./routes/not-found-page.tsx";

/**
 * Root of the marketing + docs site. A plain wouter route switch over static,
 * presentational pages — no data fetching, no providers — so the whole tree
 * is safe to prerender to static HTML later. Reuses the app's design system
 * (and wouter's default browser router) for client-side navigation.
 */
export function App() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/docs" component={DocsPage} />
      <Route component={NotFoundPage} />
    </Switch>
  );
}
