import { asc, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import type { KiriDb } from "./db/index.ts";
import { runSteps, runs } from "./db/schema.ts";
import { type EventBus, mountEventsRoute } from "./events/index.ts";
import type { CancelRegistry } from "./runner/cancel-registry.ts";
import { runWorkflow } from "./runner/index.ts";
import type { Registry, WorkflowDefinition } from "./workflows/index.ts";

/**
 * Dependencies the HTTP API needs to do real work: the state DB, the live
 * workflow registry, and the repo root passed to the runner. `staticRoot`
 * locates the built SPA bundle and defaults to the prod path; tests pass a
 * fixture directory. `bus`, when supplied, is forwarded to the runner so
 * triggered runs publish lifecycle events to downstream consumers, and
 * mounts `GET /api/events` so clients can stream those events live.
 * `eventsHeartbeatMs` overrides the SSE keep-alive cadence (test hook).
 */
export interface AppDeps {
  db: KiriDb;
  registry: Registry;
  cwd: string;
  staticRoot?: string;
  bus?: EventBus;
  eventsHeartbeatMs?: number;
  /**
   * Cancel registry for in-flight runs. When supplied, triggered runs are
   * registered with it (so their child processes can be reached) and
   * `POST /api/runs/:id/cancel` is mounted. Without it, the cancel route
   * is omitted entirely.
   */
  cancelRegistry?: CancelRegistry;
}

const DEFAULT_STATIC_ROOT = "./dist/client";

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
  const {
    db,
    registry,
    cwd,
    staticRoot = DEFAULT_STATIC_ROOT,
    bus,
    eventsHeartbeatMs,
    cancelRegistry,
  } = deps;
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

  app.post("/api/workflows/:name/runs", (c) => {
    const name = c.req.param("name");
    const wf = registry.getWorkflow(name);
    if (!wf) return c.json({ error: `workflow "${name}" not found` }, 404);
    const { runId, done } = runWorkflow(db, wf, {
      cwd,
      trigger: "manual",
      bus,
      cancelRegistry,
    });
    // Background execution: log unhandled rejections so they don't trip the
    // process-wide handler. The run row is finalised inside `done` before any
    // re-throw, so the DB stays consistent regardless.
    done.catch((cause) => {
      console.error(`run ${runId} crashed: ${cause instanceof Error ? cause.message : cause}`);
    });
    return c.json({ runId, status: "running" }, 202);
  });

  if (cancelRegistry) {
    app.post("/api/runs/:id/cancel", (c) => {
      const id = c.req.param("id");
      const run = db.select().from(runs).where(eq(runs.id, id)).get();
      if (!run) return c.json({ error: `run "${id}" not found` }, 404);
      if (run.status !== "running") {
        return c.json({ error: `run "${id}" is not in flight` }, 409);
      }
      // requestCancel returns false only if the registry has no entry — i.e.
      // the runner already released it in the small window between our DB
      // read above and this call. Treat as already-terminal.
      if (!cancelRegistry.requestCancel(id)) {
        return c.json({ error: `run "${id}" is not in flight` }, 409);
      }
      return c.json({ runId: id }, 202);
    });
  }

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
      rows.map((row) => ({ ...row, isInterrupted: !registry.getWorkflow(row.workflowName) })),
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
      run: { ...run, isInterrupted: !registry.getWorkflow(run.workflowName) },
      steps,
    });
  });

  if (bus) {
    mountEventsRoute(
      app,
      eventsHeartbeatMs === undefined ? { bus } : { bus, heartbeatMs: eventsHeartbeatMs },
    );
  }

  // The SPA shell ships at stable paths (/, /app.js, /app.css), so there is no
  // content hash to bust the browser cache when kiri serves an updated bundle.
  // Force revalidation via Cache-Control. Hashed assets under /assets/ are
  // immutable and stay freely cacheable.
  app.use("*", async (c, next) => {
    await next();
    if (NO_STORE_PATHS.has(c.req.path)) c.header("Cache-Control", "no-store");
  });

  // Serve real bundle files: /, /index.html, /app.{js,css}, hashed assets
  // under /assets/. Hono's serveStatic finalises the response when a file
  // matches and otherwise calls next(), so unknown paths fall through to
  // the SPA fallback below.
  app.use("*", serveStatic({ root: staticRoot }));

  // SPA fallback for client-side routes. serveStatic above doesn't rewrite
  // unknown paths to index.html, so a refresh on /runs/:id would 404. Catch
  // any unmatched GET that isn't an API call or a hashed asset and return
  // the SPA shell. Same bytes as /index.html, so the same no-store policy
  // applies — a fresh shell every load means client updates propagate.
  app.get("*", (c, next) => {
    if (c.finalized) return next();
    const path = c.req.path;
    if (path.startsWith("/api/") || path.startsWith("/assets/")) return next();
    c.header("Cache-Control", "no-store");
    return serveStatic({ root: staticRoot, path: "index.html" })(c, next);
  });

  return app;
}
