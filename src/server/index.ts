import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { KiriDb } from "./db/index.ts";
import { EMBEDDED_FILES } from "./embedded-assets.ts";
import { type EventBus, mountEventsRoute, mountRecommendationReflector } from "./events/index.ts";
import { articlesRoutes } from "./routes/articles.ts";
import { runsRoutes } from "./routes/runs.ts";
import { mountStaticRoutes } from "./routes/static.ts";
import { systemRoutes } from "./routes/system.ts";
import { workflowsRoutes } from "./routes/workflows.ts";
import type { CancelRegistry } from "./runner/cancel-registry.ts";
import type { Registry } from "./workflows/index.ts";

/**
 * Dependencies the HTTP API needs to do real work: the state DB, the live
 * workflow registry, and the repo root passed to the runner.
 *
 * `staticRoot` locates the built SPA bundle on disk. When omitted and the
 * `embedded-assets.ts` module has been populated by the release pipeline
 * (i.e. inside a compiled binary), the SPA is served from memory instead
 * and `staticRoot` is ignored. Tests and `bun start` from this repo
 * pass `staticRoot` explicitly; the empty stub keeps embedded mode
 * dormant on the main branch.
 *
 * `bus`, when supplied, is forwarded to the runner so triggered runs
 * publish lifecycle events to downstream consumers, and mounts
 * `GET /api/events` so clients can stream those events live.
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
  /**
   * Inject the embedded-SPA map directly (test seam). Production reads
   * from `embedded-assets.ts`; tests pass a `Map` to exercise the
   * embedded code path without going through `bun build --compile`.
   * Ignored when `staticRoot` is also set — explicit disk path wins.
   */
  embeddedFiles?: Map<string, Uint8Array>;
  /**
   * The kiri version string surfaced on `GET /api/version`. The release
   * pipeline injects the tag (e.g. "v0.1.0") at compile time via
   * `bun build --define KIRI_VERSION=…`; local `bun start` / tests fall
   * back to `"dev"`. Used by the SPA to display the running version and
   * compare against the latest GitHub release.
   */
  version?: string;
}

// Upper bound on request body size. Invoke bodies are
// `Record<string, string>` headed for env vars — real-world inputs fit
// comfortably below 1 KB, so 256 KB is generous insurance against a
// runaway local client hammering `c.req.text()` with an unbounded payload.
const BODY_LIMIT_BYTES = 256 * 1024;

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

/**
 * Build the Hono app serving kiri's HTTP API and the built SPA bundle.
 * One process, one origin: the same Hono instance powers the API and
 * serves the static client bundle.
 */
export function createApp(deps: AppDeps): Hono {
  const { db, registry, cwd, bus, eventsHeartbeatMs, cancelRegistry } = deps;
  const version = deps.version ?? "dev";
  const embeddedFiles = deps.embeddedFiles ?? EMBEDDED_FILES;
  const app = new Hono();

  // CORS allow-list for the hosted shell at https://local.kiri.build plus the
  // local-direct origins. Mounted before route handlers so OPTIONS preflight is
  // answered by the middleware rather than falling through. Disallowed origins
  // get no Access-Control-Allow-Origin header — the browser default-blocks.
  app.use(
    "*",
    cors({
      origin: ALLOWED_ORIGINS,
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", REQUIRED_CLIENT_HEADER],
    }),
  );

  // Cheap insurance against a runaway local client hammering `c.req.text()`
  // with an unbounded payload. `bodyLimit` short-circuits on bodyless
  // requests (GET/HEAD/OPTIONS), so scoping to `/api/*` is for clarity, not
  // necessity. The custom `onError` keeps the 413 body on the same
  // `{ error }` contract every other 4xx in the app honours.
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: BODY_LIMIT_BYTES,
      onError: (c) => c.json({ error: "request body too large" }, 413),
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

  // Honour the `{ error: string }` contract for unmatched routes and uncaught
  // throws. `HTTPException` carries its own status/message verbatim so handlers
  // can `throw new HTTPException(404, …)` instead of catching defensively;
  // anything else is logged and surfaced as an opaque 500 so internal detail
  // (SQL fragments, stack frames) doesn't leak to the client.
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    console.error(err);
    return c.json({ error: "internal server error" }, 500);
  });

  app.notFound((c) => c.json({ error: "not found" }, 404));

  app.route("/api", systemRoutes({ version }));
  app.route("/api/workflows", workflowsRoutes({ db, registry, cwd, bus, cancelRegistry }));
  app.route("/api/runs", runsRoutes({ db, registry, cwd, bus, cancelRegistry }));
  app.route("/api/articles", articlesRoutes({ db }));

  if (bus) {
    mountEventsRoute(
      app,
      eventsHeartbeatMs === undefined ? { bus } : { bus, heartbeatMs: eventsHeartbeatMs },
    );
    // Reflect a spawned run's status back onto the recommendation that
    // actioned it, so the producing run's detail refreshes its rec badge.
    mountRecommendationReflector(db, bus);
  }

  mountStaticRoutes(app, { staticRoot: deps.staticRoot, embeddedFiles });

  return app;
}
