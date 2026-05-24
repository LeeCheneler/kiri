import { Hono } from "hono";

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

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/version", (c) => c.json({ version: deps.version }));

  return app;
}
