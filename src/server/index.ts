import { asc, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import type { KiriDb } from "./db/index.ts";
import { runNodes, runs } from "./db/schema.ts";
import { runWorkflow } from "./runner/index.ts";
import type { Registry, WorkflowDefinition } from "./workflows/index.ts";

/**
 * Dependencies the HTTP API needs to do real work: the state DB, the live
 * workflow registry, and the repo root passed to the runner.
 */
export interface AppDeps {
  db: KiriDb;
  registry: Registry;
  cwd: string;
}

const summarizeWorkflow = (def: WorkflowDefinition) => ({
  name: def.name,
  nodes: def.nodes,
  gating: def.gating,
  schedule: def.schedule,
});

const DEFAULT_RUN_LIMIT = 50;
const MAX_RUN_LIMIT = 200;

const parseListParam = (raw: string | undefined, fallback: number, max: number): number => {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
};

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

  app.get("/api/runs", (c) => {
    const limit = parseListParam(c.req.query("limit"), DEFAULT_RUN_LIMIT, MAX_RUN_LIMIT);
    const offset = parseListParam(c.req.query("offset"), 0, Number.MAX_SAFE_INTEGER);
    const rows = db
      .select()
      .from(runs)
      .orderBy(desc(runs.startedAt))
      .limit(limit)
      .offset(offset)
      .all();
    return c.json(
      rows.map((row) => ({ ...row, isOrphan: !registry.getWorkflow(row.workflowName) })),
    );
  });

  app.get("/api/runs/:id", (c) => {
    const id = c.req.param("id");
    const run = db.select().from(runs).where(eq(runs.id, id)).get();
    if (!run) return c.json({ error: `run "${id}" not found` }, 404);
    const nodes = db
      .select()
      .from(runNodes)
      .where(eq(runNodes.runId, id))
      .orderBy(asc(runNodes.index))
      .all();
    return c.json({
      run: { ...run, isOrphan: !registry.getWorkflow(run.workflowName) },
      nodes,
    });
  });

  app.use("*", serveStatic({ root: "./dist/client" }));

  return app;
}
