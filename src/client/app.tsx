import { Route, Switch } from "wouter";
import { Dashboard } from "./dashboard.tsx";
import { RunPage } from "./run-page.tsx";

/**
 * Root client shell. Two routes today: the dashboard and the run detail
 * page. wouter reads `window.location` directly, so no provider is needed
 * — `<Switch>` picks the first matching `<Route>`.
 */
export function App() {
  return (
    <>
      <header>
        <h1 className="text-3xl font-bold">Kiri</h1>
      </header>
      <main>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/runs/:id" component={RunPage} />
          <Route>
            <p>Page not found.</p>
          </Route>
        </Switch>
      </main>
    </>
  );
}
