import { asc, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import type { KiriDb } from "./db/index.ts";
import { runSteps, runs } from "./db/schema.ts";
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
  steps: def.steps,
  gating: def.gating,
  schedule: def.schedule,
});

const DEFAULT_RUN_LIMIT = 50;
const MAX_RUN_LIMIT = 200;

const NO_STORE_PATHS = new Set(["/", "/index.html", "/app.js", "/app.css"]);

const ALLOWED_ORIGINS = [
  "https://local.kiri.build",
  "http://127.0.0.1:4242",
  "http://localhost:4242",
];

// Custom header required on every state-changing request. Browsers will only
// send it cross-origin after a successful CORS preflight permitting the header,
// so a malicious page in another tab cannot satisfy the check even if the CORS
// allow-list is misconfigured. Presence-only — the value is irrelevant.
const REQUIRED_CLIENT_HEADER = "X-Kiri-Client";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

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

  // CORS allow-list for the hosted shell at https://local.kiri.build plus the
  // local-direct origins. Mounted before route handlers so OPTIONS preflight is
  // answered by the middleware rather than falling through. Disallowed origins
  // get no Access-Control-Allow-Origin header — the browser default-blocks.
  app.use(
    "*",
    cors({
      origin: ALLOWED_ORIGINS,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", REQUIRED_CLIENT_HEADER],
    }),
  );

  // Belt-and-braces CSRF defence layered on top of the CORS allow-list.
  // Custom headers force a CORS preflight; a cross-origin attacker can't
  // satisfy it without an explicit Access-Control-Allow-Headers permitting
  // the header — so even if the CORS allow-list ever drifts, state-changing
  // requests from disallowed origins are still rejected here.
  app.use("*", async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    if (!c.req.header(REQUIRED_CLIENT_HEADER)) {
      return c.json({ error: `${REQUIRED_CLIENT_HEADER} header required` }, 403);
    }
    return next();
  });

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
    const steps = db
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, id))
      .orderBy(asc(runSteps.index))
      .all();
    return c.json({
      run: { ...run, isOrphan: !registry.getWorkflow(run.workflowName) },
      steps,
    });
  });

  // The SPA shell ships at stable paths (/, /app.js, /app.css), so there is no
  // content hash to bust the browser cache when kiri serves an updated bundle.
  // Force revalidation via Cache-Control. Hashed assets under /assets/ are
  // immutable and stay freely cacheable.
  app.use("*", async (c, next) => {
    await next();
    if (NO_STORE_PATHS.has(c.req.path)) c.header("Cache-Control", "no-store");
  });

  app.use("*", serveStatic({ root: "./dist/client" }));

  return app;
}
