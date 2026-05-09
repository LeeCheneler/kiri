import { Route, Switch } from "wouter";
import { PageShell } from "./components/page-shell.tsx";
import { Dashboard } from "./routes/dashboard.tsx";
import { RunPage } from "./routes/run-page.tsx";
import { WorkflowPage } from "./routes/workflow-page.tsx";

/**
 * Root client shell. Wraps the wouter route switch in the page shell so
 * every route inherits the three-column layout and the kiri wordmark.
 */
export function App() {
  return (
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
  );
}
