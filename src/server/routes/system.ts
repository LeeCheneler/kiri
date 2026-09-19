import { Hono } from "hono";
import type * as systemApi from "../../shared/api/system.ts";

export interface SystemRoutesDeps {
  /** Resolved version string surfaced on `GET /api/version`. */
  version: string;
}

/**
 * Build the Hono sub-app for kiri's system info endpoints: a liveness
 * probe and the running version. Mounted under `/api` by `createApp`.
 */
export function systemRoutes(deps: SystemRoutesDeps): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" } satisfies systemApi.HealthResult));

  app.get("/version", (c) => c.json({ version: deps.version } satisfies systemApi.VersionInfo));

  return app;
}
