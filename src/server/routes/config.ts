import { Hono } from "hono";
import {
  evaluateConfigHealth,
  evaluateModelListingHealth,
  evaluateProviderAuthHealth,
} from "../config/health.ts";
import { loadKiriConfig } from "../config/loader.ts";
import type { ConfigStore } from "../config/store.ts";
import type { LlmClients } from "../llm/index.ts";

export interface ConfigRoutesDeps {
  /** Workspace config — the health check reads `kiri.yaml` against it. */
  config: ConfigStore;
  /** Environment the health check resolves provider keys against. */
  env: Record<string, string | undefined>;
  /**
   * When present, the health report also checks configured model references
   * against the live provider listings (a shortcut or delegate pointing at a
   * model its provider doesn't list). Absent, only config and local credential checks run.
   */
  llmClients?: LlmClients;
}

/**
 * Build the Hono sub-app for configuration info. `GET /health` returns the
 * workspace's configuration-health report — the pure checks printed at boot,
 * plus local credential checks and listing-level model checks when an LLM surface is wired — read fresh
 * per request so it reflects edits the config watcher has picked up. Mounted
 * under `/api/config` by `createApp`, unconditionally: it is how the client
 * learns *why* there may be no providers.
 */
export function configRoutes(deps: ConfigRoutesDeps): Hono {
  const app = new Hono();

  app.get("/health", async (c) => {
    const kiriConfig = loadKiriConfig(deps.config, deps.env);
    const health = evaluateConfigHealth({ kiriConfig, env: deps.env });
    health.checks.push(...(await evaluateProviderAuthHealth(kiriConfig, deps.env)));
    if (deps.llmClients) {
      health.checks.push(...(await evaluateModelListingHealth(kiriConfig, deps.llmClients)));
    }
    return c.json(health);
  });

  return app;
}
