import { Hono } from "hono";
import type * as configApi from "../../shared/api/config.ts";
import {
  evaluateConfigHealth,
  evaluateModelListingHealth,
  evaluateProviderAuthHealth,
} from "../config/health.ts";
import type { ConfigService } from "../config/service.ts";
import type { LlmClients } from "../llm/index.ts";

export interface ConfigRoutesDeps {
  /** The workspace's effective config — the health check reports on its latest load. */
  configService: ConfigService;
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
 * plus local credential checks and listing-level model checks when an LLM surface is wired — taken
 * from the config service per request, so it reflects the file as it is now. Mounted
 * under `/api/config` by `createApp`, unconditionally: it is how the client
 * learns *why* there may be no providers.
 */
export function configRoutes(deps: ConfigRoutesDeps): Hono {
  const app = new Hono();

  app.get("/health", async (c) => {
    const kiriConfig = deps.configService.current();
    const health = evaluateConfigHealth({ kiriConfig, env: deps.env });
    // A failed load is the whole report. The snapshot still carries the last
    // good providers, but checking those would describe a file that is gone.
    if (!kiriConfig.diagnostics.failure) {
      health.checks.push(...(await evaluateProviderAuthHealth(kiriConfig, deps.env)));
      if (deps.llmClients) {
        health.checks.push(...(await evaluateModelListingHealth(kiriConfig, deps.llmClients)));
      }
    }
    return c.json(health satisfies configApi.ConfigHealth);
  });

  return app;
}
