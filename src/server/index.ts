import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { z } from "zod";
import type { KiriDb } from "./db/index.ts";
import { runWorkflow } from "./runner/index.ts";
import type { BrandedWorkflowDefinition, Registry } from "./workflows/index.ts";

/**
 * Dependencies the HTTP API needs to do real work: the state DB, the live
 * workflow registry, and the repo root passed to the runner.
 */
export interface AppDeps {
  db: KiriDb;
  registry: Registry;
  cwd: string;
}

const summarizeWorkflow = (def: BrandedWorkflowDefinition) => ({
  name: def.name,
  nodes: def.nodes,
  gating: def.gating,
  schedule: def.schedule,
  inputSchema: z.toJSONSchema(def.inputSchema),
});

/**
 * Build the Hono app serving kiri's HTTP API and the built SPA bundle.
 * One process, one origin: the same Hono instance powers the API and
 * serves the static client bundle.
 */
export function createApp(deps: AppDeps): Hono {
  const { db, registry, cwd } = deps;
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ status: "ok" }));

  app.get("/api/workflows", (c) => c.json(registry.listWorkflows().map(summarizeWorkflow)));

  app.post("/api/workflows/:name/runs", async (c) => {
    const name = c.req.param("name");
    const wf = registry.getWorkflow(name);
    if (!wf) return c.json({ error: `workflow "${name}" not found` }, 404);
    const result = await runWorkflow(db, wf, { cwd, trigger: "manual" });
    return c.json(result);
  });

  app.use("*", serveStatic({ root: "./dist/client" }));

  return app;
}
