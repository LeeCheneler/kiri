import { Hono } from "hono";
import { evaluateConfigHealth } from "../config/health.ts";
import { loadKiriConfig } from "../config/loader.ts";
import type { ConfigStore } from "../config/store.ts";

export interface ConfigRoutesDeps {
  /** Workspace config — the health check reads `kiri.yaml` against it. */
  config: ConfigStore;
  /** Environment the health check resolves provider and Tavily keys against. */
  env: Record<string, string | undefined>;
}

/**
 * Build the Hono sub-app for configuration info. `GET /health` returns the
 * workspace's configuration-health report — the same one printed at boot —
 * read fresh per request so it reflects edits the config watcher has picked
 * up. Mounted under `/api/config` by `createApp`, unconditionally: it is how
 * the client learns *why* there may be no providers.
 */
export function configRoutes(deps: ConfigRoutesDeps): Hono {
  const app = new Hono();

  app.get("/health", (c) => {
    const kiriConfig = loadKiriConfig(deps.config, deps.env);
    return c.json(evaluateConfigHealth({ kiriConfig, env: deps.env }));
  });

  return app;
}
