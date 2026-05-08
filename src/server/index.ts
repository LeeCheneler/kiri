import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import type { KiriDb } from "./db/index.ts";
import type { Registry } from "./workflows/index.ts";

/**
 * Dependencies the HTTP API needs to do real work: the state DB, the live
 * workflow registry, and the repo root passed to the runner.
 */
export interface AppDeps {
  db: KiriDb;
  registry: Registry;
  cwd: string;
}

/**
 * Build the Hono app serving kiri's HTTP API and the built SPA bundle.
 * One process, one origin: the same Hono instance powers the API and
 * serves the static client bundle.
 */
export function createApp(_deps: AppDeps): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ status: "ok" }));

  app.use("*", serveStatic({ root: "./dist/client" }));

  return app;
}
