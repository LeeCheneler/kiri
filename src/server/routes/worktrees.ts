import { Hono } from "hono";
import { loadKiriConfig } from "../config/loader.ts";
import type { ConfigStore } from "../config/store.ts";
import type { EventBus } from "../events/index.ts";
import { resolveWorktreeRoots } from "../worktrees/config.ts";
import { worktreesOverview } from "../worktrees/overview.ts";

export interface WorktreesRoutesDeps {
  /** Workspace config — the scanned roots are read from its `worktrees:` section. */
  config: ConfigStore;
  /** Environment the config load resolves against. */
  env: Record<string, string | undefined>;
  /** When supplied, a refresh publishes `worktrees.changed` so live clients refetch. */
  bus?: EventBus;
}

/**
 * Build the Hono sub-app for `/api/worktrees`. `GET /` returns the grouped
 * model — the scanned roots plus each discovered repo with the live status of
 * its primary checkout and linked worktrees — rebuilt from disk per request, so
 * it always reflects the current `worktrees:` roots. `POST /refresh` returns the
 * same freshly-built model and publishes `worktrees.changed`, so the client that
 * asked and every other open client converge on it.
 *
 * Mounted unconditionally: with no roots configured it answers with an empty
 * model, which is how the client learns there is nothing to scan.
 */
export function worktreesRoutes(deps: WorktreesRoutesDeps): Hono {
  const app = new Hono();

  const overview = () =>
    worktreesOverview(
      resolveWorktreeRoots(loadKiriConfig(deps.config, deps.env).worktrees, deps.config.cwd()),
    );

  app.get("/", (c) => c.json(overview()));

  app.post("/refresh", (c) => {
    const result = overview();
    deps.bus?.publish({ type: "worktrees.changed" });
    return c.json(result);
  });

  return app;
}
